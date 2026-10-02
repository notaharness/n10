import type * as Primitive from '@n10/core';
import { beforeEach, expect, it, vi } from 'vitest';
import { worktreeSessionKey } from '@n10/core';
import type { DiscoveryScan } from '@n10/core';
import type { AppConfig } from '@n10/vcs-core';
import { worktreeScope } from '@n10/worktree-manager';
import type { WorktreeService } from '../worktrees/api.js';
import type { SessionDiscoveryOptions } from './session-discovery.js';
import { createSessionConnections } from './session-connections.js';
import { createSessionService } from './session-service.js';

const state = vi.hoisted(() => ({
  scan: null as SessionDiscoveryOptions | null,
  scanNow: vi.fn(async () => undefined),
  stopScan: vi.fn(),
  lastScan: vi.fn((): DiscoveryScan | null => null),
  launch: vi.fn(),
  stop: vi.fn(),
  exit: (): void => undefined,
  entries: new Map<
    string,
    { exited: boolean; pty: { connectionState?: string } }
  >(),
}));
vi.mock('./session-discovery.js', () => ({
  startSessionDiscovery: (options: SessionDiscoveryOptions) => {
    state.scan = options;
    return {
      scanNow: state.scanNow,
      stop: state.stopScan,
      lastScan: state.lastScan,
    };
  },
}));
vi.mock('@n10/core', async (original) => ({
  ...(await original<typeof Primitive>()),
  launchSession: state.launch,
  stopSession: state.stop,
  getSession: (name: string) => state.entries.get(name),
  sessionNames: () => [...state.entries.keys()],
  isSessionAlive: (name: string) => state.entries.get(name)?.exited === false,
  hasSessionConnection: (name: string) => state.entries.has(name),
  getSpawnedAt: () => 42,
  onSessionExit: (listener: () => void) => {
    state.exit = listener;
    return () => {
      state.exit = () => undefined;
    };
  },
}));
const wt = { branch: 'feature', path: '/repo/wt', bare: false };
const key = worktreeSessionKey(wt.path, '/repo');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(lastScans?: Map<string, DiscoveryScan>) {
  const selected = {
    current: true,
    config: {
      agentId: 'claude',
      vendorAuth: {},
      vendorProject: {},
    } as AppConfig,
  };
  const config = {
    repo: '/repo',
    getSnapshot: () => ({ config: selected.config }),
    subscribe: () => () => undefined,
  };
  const snapshot = {
    worktrees: [wt],
    branches: ['feature'],
    allBranches: ['feature'],
    loading: false,
    error: null,
  };
  const worktrees: WorktreeService = {
    scope: () =>
      worktreeScope('/repo', { template: selected.config.worktreePath }),
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    read: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => snapshot),
    find: vi.fn(async () => wt),
    resolve: vi.fn(async () => wt.path),
    create: vi.fn(async () => wt.path),
    checkRemoval: vi.fn(),
    remove: vi.fn(),
    fetchBranches: vi.fn(),
    rebase: vi.fn(),
    dispose: vi.fn(),
  };
  const service = createSessionService({
    config,
    worktrees,
    isCurrent: () => selected.current,
    lastScans,
  });
  return { service, worktrees, selected };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.scan = null;
  state.lastScan.mockReset().mockReturnValue(null);
  state.entries.clear();
  state.launch
    .mockReset()
    .mockImplementation(async ({ name }: { name: string }) => {
      const entry = { exited: false, pty: {} };
      state.entries.set(name, entry);
      return entry;
    });
});
const request = {
  target: { branch: 'feature' },
  request: { intent: 'blank' as const },
};
const size = () => ({ cols: 90, rows: 30 });

it('observes the handle’s live worktree scope and stops without detaching connections', async () => {
  const f = fixture();
  f.service.watch({ size });
  f.selected.config = { ...f.selected.config, worktreePath: '/changed' };
  expect(state.scan!.scope().resolver.base()).toBe('/changed');
  await f.service.launch(request);
  f.service.dispose();
  expect(state.stopScan).toHaveBeenCalledOnce();
  expect(state.entries.has(key)).toBe(true);
  expect(state.stop).not.toHaveBeenCalled();
});

it('adopts the exact observed checkout with the captured repository config', async () => {
  const f = fixture();
  const started = vi.fn();
  f.service.watch({ size, started });
  await state.scan!.adopt({ name: key, path: wt.path, branch: '' });
  expect(state.launch).toHaveBeenCalledWith(
    expect.objectContaining({
      name: key,
      cwd: wt.path,
      mode: 'attach',
      cols: 90,
      rows: 30,
      config: f.selected.config,
    })
  );
  expect(state.launch.mock.calls[0][0]).not.toHaveProperty('branch');
  expect(started).toHaveBeenCalledWith(key, '/repo');
  expect(f.worktrees.create).not.toHaveBeenCalled();
  f.service.dispose();
});

it('does not attach after discovery stops during an ownership check', async () => {
  const f = fixture();
  const gate = deferred<undefined>();
  const stop = f.service.watch({ size, beforeLaunch: () => gate.promise });
  const attach = state.scan!.adopt({
    name: key,
    path: wt.path,
    branch: wt.branch,
  });
  stop();
  gate.resolve(undefined);
  await attach;
  expect(state.launch).not.toHaveBeenCalled();
  f.service.dispose();
});

it('refuses a launch when selection changes during worktree resolution', async () => {
  const f = fixture();
  const gate = deferred<typeof wt>();
  vi.mocked(f.worktrees.find).mockReturnValue(gate.promise);
  const launch = f.service.launch(request);
  f.selected.current = false;
  gate.resolve(wt);
  await expect(launch).rejects.toThrow('repository changed');
  expect(state.launch).not.toHaveBeenCalled();
  expect(f.worktrees.resolve).not.toHaveBeenCalled();
  f.service.dispose();
});

it('captures launch config before its first await', async () => {
  const f = fixture();
  const gate = deferred<typeof wt>();
  vi.mocked(f.worktrees.find).mockReturnValue(gate.promise);
  const launch = f.service.launch(request);
  f.selected.config = { ...f.selected.config, agentId: 'codex' };
  gate.resolve(wt);
  await launch;
  expect(state.launch).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: expect.objectContaining({ id: 'claude' }),
    })
  );
  f.service.dispose();
});

it('joins identical launches and refuses conflicting requests for the same resolved checkout', async () => {
  const f = fixture();
  const gate = deferred<{ exited: boolean; pty: object }>();
  state.launch.mockReturnValueOnce(gate.promise);
  const first = f.service.launch(request);
  expect(f.service.launch({ ...request })).toBe(first);
  await vi.waitFor(() => expect(state.launch).toHaveBeenCalledOnce());
  await expect(
    f.service.launch({ ...request, target: { session: key } })
  ).rejects.toThrow('Another launch');
  gate.resolve({ exited: false, pty: {} });
  expect(await first).toBe(key);
  expect(state.launch).toHaveBeenCalledOnce();
  f.service.dispose();
});

it('publishes exit facts without reattaching the agent', async () => {
  const f = fixture();
  state.entries.set(key, { exited: false, pty: {} });
  f.service.watch({ size });
  await f.service.read();
  const before = f.service.getSnapshot();
  expect(before.sessions[0].running).toBe(true);
  const changed = vi.fn();
  f.service.subscribe(changed);
  state.entries.get(key)!.exited = true;
  state.exit();
  expect(changed).toHaveBeenCalledOnce();
  expect(f.service.getSnapshot().sessions[0].running).toBe(false);
  expect(state.launch).not.toHaveBeenCalled();
  f.service.dispose();
});

it('reports only this repository’s connections and hides local reconnect transport state', () => {
  const f = fixture();
  const remote = worktreeSessionKey('/remote/wt', '/repo', 'peer');
  state.entries.set(key, {
    exited: false,
    pty: { connectionState: 'reconnecting' },
  });
  state.entries.set(remote, {
    exited: false,
    pty: { connectionState: 'failed' },
  });
  state.entries.set(worktreeSessionKey('/other/wt', '/other'), {
    exited: false,
    pty: {},
  });
  expect(f.service.connections()).toEqual([
    {
      name: key,
      running: true,
      spawnedAt: 42,
      machine: 'local',
      connectionState: undefined,
    },
    {
      name: remote,
      running: true,
      spawnedAt: 42,
      machine: 'peer',
      connectionState: 'failed',
    },
  ]);
  expect(() =>
    f.service.stop(worktreeSessionKey('/other/wt', '/other'))
  ).toThrow('another repository');
  expect(state.stop).not.toHaveBeenCalled();
  f.service.dispose();
});

it('retains a stopped launch across repository handle replacement', async () => {
  const connections = createSessionConnections();
  const f = fixture();
  const config = {
    repo: '/repo',
    getSnapshot: () => ({ config: f.selected.config }),
    subscribe: () => () => undefined,
  };
  const options = {
    config,
    worktrees: f.worktrees,
    connections,
    isCurrent: () => true,
  };
  const first = createSessionService(options);
  await first.launch(request);
  state.stop.mockImplementationOnce((name: string) =>
    state.entries.delete(name)
  );
  first.stop(key);
  first.dispose();
  const reopened = createSessionService(options);
  expect(reopened.connections()).toEqual([
    expect.objectContaining({ name: key, running: false }),
  ]);
  expect(connections.read('/other')).toEqual([]);
  reopened.dispose();
  f.service.dispose();
});
it('names the branch of a terminal in a linked checkout, never the main checkout’s', () => {
  const { service, worktrees } = fixture();
  worktrees
    .getSnapshot()
    .worktrees.push({ branch: 'main', path: '/repo', bare: false });
  const shell = {
    name: 'shell',
    kind: 'shell' as const,
    cwd: '/repo/wt/src',
    machine: 'local',
    running: true,
    spawnedAt: 1,
  };
  expect(service.terminalBranch(shell)).toBe('feature');
  expect(service.terminalBranch({ ...shell, cwd: '/repo' })).toBeUndefined();
  expect(
    service.branchSessions('feature', [shell]).sessions.map((s) => s.name)
  ).toEqual(['shell']);
});
it('checks a branch out on another machine and knows its terminals there', async () => {
  const { service, worktrees } = fixture();
  const machine = {
    id: 'peer',
    executor: {
      run: vi.fn(async () => ({
        stdout: '/home/them/wt\n',
        stderr: '',
        code: 0,
      })),
    },
  };
  vi.mocked(worktrees.create).mockResolvedValueOnce('/home/them/wt');
  await expect(
    service.checkoutOn('feature', { id: 'peer', machine })
  ).resolves.toBe('/home/them/wt');
  expect(worktrees.create).toHaveBeenCalledWith('feature', machine);
  expect(
    service.terminalBranch({ machine: 'peer', cwd: '/home/them/wt' })
  ).toBe('feature');
  expect(
    service.terminalBranch({ machine: 'local', cwd: '/home/them/wt' })
  ).toBe(undefined);
});

const scanOf = (...listed: (typeof wt)[]): DiscoveryScan => ({
  worktrees: listed.map((w) => ({
    name: worktreeSessionKey(w.path, '/repo'),
    branch: w.branch,
    path: w.path,
  })),
  persisted: new Set(),
  terminals: [],
});

// Another repository's handle replaces this one while it is open; the
// next handle's scanner must still see what went meanwhile.
it('starts a reopened repository’s discovery from its previous scan', () => {
  const lastScans = new Map<string, DiscoveryScan>();
  const before = scanOf(wt);
  const first = fixture(lastScans);
  first.service.watch({ size });
  state.lastScan.mockReturnValue(before);
  first.service.dispose();

  fixture(lastScans).service.watch({ size });
  expect(state.scan!.baseline).toBe(before);
});

// Discovery reports only the removal of a worktree it has seen, and a
// shell can show (and open a tab for) any worktree the resource lists.
it('scans at once for a listed worktree discovery has not seen', async () => {
  const f = fixture();
  f.service.watch({ size });
  state.lastScan.mockReturnValue(scanOf());
  state.scanNow.mockClear();
  await f.service.refresh();
  expect(state.scanNow).toHaveBeenCalled();
});

it('leaves discovery to its schedule when it has seen every listed worktree', async () => {
  const f = fixture();
  f.service.watch({ size });
  state.lastScan.mockReturnValue(scanOf(wt));
  state.scanNow.mockClear();
  await f.service.refresh();
  expect(state.scanNow).not.toHaveBeenCalled();
});
