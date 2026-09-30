import type * as Primitive from '@n10/core';
import { beforeEach, expect, it, vi } from 'vitest';
import { worktreeSessionKey } from '@n10/core';
import type { AppConfig } from '@n10/vcs-core';
import { worktreeScope } from '@n10/worktree-manager';
import type { WorktreeService } from '../worktrees/worktree-service.js';
import type { SessionDiscoveryOptions } from './session-discovery.js';
import { createSessionConnections } from './session-connections.js';
import { createSessionService } from './session-service.js';

const state = vi.hoisted(() => ({
  scan: null as SessionDiscoveryOptions | null,
  scanNow: vi.fn(async () => undefined),
  stopScan: vi.fn(),
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
    return { scanNow: state.scanNow, stop: state.stopScan };
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
function fixture() {
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
  });
  return { service, worktrees, selected };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.scan = null;
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
  expect(connections('/other')).toEqual([]);
  reopened.dispose();
  f.service.dispose();
});
