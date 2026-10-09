import type * as Fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type * as Vcs from '@n10/vcs-core';
import { beforeEach, expect, it, vi } from 'vitest';
import type * as Core from '@n10/core';
import { terminalSessionKey } from '@n10/core';
import { createTerminalService } from './terminal-service.js';

const state = vi.hoisted(() => ({
  launch: vi.fn(),
  stat: vi.fn<(path: string) => { isDirectory(): boolean }>(),
  config: vi.fn((cwd: string) => ({ cwd })),
  persisted: new Set<string>(),
  entries: new Map<
    string,
    {
      pty: {
        onExit: (cb: () => void) => void;
        connectionState?: 'connected' | 'reconnecting' | 'failed';
      };
    }
  >(),
  next: 0,
  exits: [] as (() => void)[],
  kill: vi.fn(),
  release: vi.fn(),
  detach: vi.fn(),
  remoteRun: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof Fs>()),
  statSync: state.stat,
}));
vi.mock('@n10/vcs-core', async (original) => ({
  ...(await original<typeof Vcs>()),
  readConfig: state.config,
}));
vi.mock('@n10/core', async (original) => ({
  ...(await original<typeof Core>()),
  launchTerminalSession: state.launch,
  getSession: (name: string) => state.entries.get(name),
  getSpawnedAt: () => 42,
  isSessionAlive: (name: string) => state.entries.has(name),
  hasPersistedTerminalSession: (name: string) => state.persisted.has(name),
  killSession: state.kill,
  releaseExitedSession: state.release,
  detachSession: state.detach,
  requireMachine: (id: string) => ({
    id,
    executor: { run: state.remoteRun },
  }),
  captureTmuxRuntime: state.capture,
}));
const local = terminalSessionKey('terminal');
const remote = terminalSessionKey('terminal', 'peer');
function register(name: string) {
  const entry = {
    pty: {
      onExit: (cb: () => void) => {
        state.exits.push(cb);
      },
    },
  };
  state.entries.set(name, entry);
  return { ...entry, name };
}
function fixture() {
  const ports = { started: vi.fn(), ended: vi.fn() };
  return { service: createTerminalService(ports), ports };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.entries.clear();
  state.persisted.clear();
  state.exits = [];
  state.next = 0;
  state.capture.mockReset().mockReturnValue({});
  state.stat.mockReset().mockReturnValue({ isDirectory: () => true });
  state.kill
    .mockReset()
    .mockImplementation((name: string) => state.entries.delete(name));
  state.release
    .mockReset()
    .mockImplementation((name: string) => state.entries.delete(name));
  state.detach
    .mockReset()
    .mockImplementation((name: string) => state.entries.delete(name));
  state.launch
    .mockReset()
    .mockImplementation(
      async ({ name, machine }: { name?: string; machine?: string }) =>
        register(
          name ??
            terminalSessionKey(
              state.next++ === 0 ? 'terminal' : `terminal-${state.next}`,
              machine
            )
        )
    );
});

it('uses the retained terminal’s directory, kind and machine when a restart supplies conflicting fields', async () => {
  const { service } = fixture();
  await service.adopt({
    name: remote,
    kind: 'agent',
    path: '/remote/checkout',
  });
  state.stat.mockClear();
  const summary = await service.launch({
    sessionName: remote,
    kind: 'shell',
    cwd: '/unrelated',
    machine: 'local',
    fresh: true,
  });
  expect(state.stat).not.toHaveBeenCalled();
  expect(state.config).toHaveBeenLastCalledWith('/remote/checkout');
  expect(state.launch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      name: remote,
      cwd: '/remote/checkout',
      kind: 'agent',
      machine: undefined,
      fresh: true,
    })
  );
  expect(summary).toMatchObject({
    name: remote,
    cwd: '/remote/checkout',
    kind: 'agent',
    machine: 'peer',
  });
});

it('coalesces concurrent discovery attachment before installing output delivery', async () => {
  const { service, ports } = fixture();
  const discovered = { name: local, kind: 'shell' as const, path: '/repo' };
  await Promise.all([service.adopt(discovered), service.adopt(discovered)]);
  expect(state.launch).toHaveBeenCalledOnce();
  expect(ports.started).toHaveBeenCalledOnce();
  expect(service.names()).toEqual([local]);
});

it('keeps an ended agent while tmux retains it and forgets it only after the native target disappears', async () => {
  const { service, ports } = fixture();
  await service.adopt({ name: local, kind: 'agent', path: '/repo' });
  state.persisted.add(local);
  state.exits[0]();
  service.forget(local);
  expect(service.has(local)).toBe(true);
  expect(ports.ended).not.toHaveBeenCalled();
  expect(state.release).not.toHaveBeenCalled();
  state.persisted.delete(local);
  service.forget(local);
  expect(service.has(local)).toBe(false);
  expect(state.detach).toHaveBeenCalledExactlyOnceWith(local);
  expect(state.kill).not.toHaveBeenCalled();
  expect(ports.ended).toHaveBeenCalledExactlyOnceWith(local);
});

it('refreshes the owning agent runtime and retains it after the pane exits', async () => {
  const { service } = fixture();
  const conversationId = '123e4567-e89b-12d3-a456-426614174000';
  state.capture
    .mockReturnValueOnce({})
    .mockReturnValueOnce({
      env: { CLAUDE_CONFIG_DIR: '/session/claude' },
      conversationId,
    })
    .mockReturnValue({});
  state.launch.mockImplementationOnce(async () => {
    const entry = register(local);
    return {
      ...entry,
      agent: 'claude',
      pty: { ...entry.pty, target: { kind: 'tmux', name: 'real-tmux' } },
    };
  });
  await service.launch({ kind: 'agent', cwd: '/repo' });
  expect(state.capture).toHaveBeenCalledWith('real-tmux', undefined, 'claude');
  expect(service.list()[0].restore).toMatchObject({
    env: { CLAUDE_CONFIG_DIR: '/session/claude' },
    conversationId,
  });
  state.persisted.add(local);
  state.exits[0]();
  expect(service.list()[0].restore).toMatchObject({
    env: { CLAUDE_CONFIG_DIR: '/session/claude' },
    conversationId,
  });
});

// Its backend stops polling a dead pane, so it keeps saying the session
// is there; discovery's listing on that machine is the word that it went.
it('forgets another machine’s retained agent when discovery finds its session gone', async () => {
  const { service, ports } = fixture();
  await service.adopt({ name: remote, kind: 'agent', path: '/far/repo' });
  state.persisted.add(remote);
  state.exits[0]();
  expect(service.has(remote)).toBe(true);
  service.forget(remote);
  expect(service.has(remote)).toBe(false);
  expect(state.detach).toHaveBeenCalledExactlyOnceWith(remote);
  expect(ports.ended).toHaveBeenCalledExactlyOnceWith(remote);
});

it('ignores an old client’s exit after replacing the same terminal', async () => {
  const { service, ports } = fixture();
  await service.adopt({ name: local, kind: 'shell', path: '/repo' });
  const priorExit = state.exits[0];
  await service.launch({ sessionName: local, kind: 'shell', cwd: '/repo' });
  priorExit();
  expect(service.has(local)).toBe(true);
  expect(ports.ended).not.toHaveBeenCalled();
  state.exits[1]();
  expect(service.has(local)).toBe(false);
  expect(state.release).toHaveBeenCalledExactlyOnceWith(local);
});

it('rejects relative and unavailable directories before spawning', async () => {
  const { service } = fixture();
  await expect(
    service.launch({ kind: 'shell', cwd: 'relative' })
  ).rejects.toThrow('absolute');
  state.stat.mockImplementationOnce(() => {
    throw new Error('ENOENT');
  });
  await expect(
    service.launch({ kind: 'shell', cwd: '/missing' })
  ).rejects.toThrow('does not exist');
  state.stat.mockReturnValueOnce({ isDirectory: () => false });
  await expect(service.launch({ kind: 'shell', cwd: '/file' })).rejects.toThrow(
    'does not exist'
  );
  expect(state.launch).not.toHaveBeenCalled();
});
it('reads config from each directory and bounds initial pane dimensions', async () => {
  const { service } = fixture();
  await service.launch({ kind: 'agent', cwd: '/project', cols: 1, rows: 900 });
  expect(state.config).toHaveBeenCalledWith('/project');
  expect(state.launch).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: '/project',
      config: { cwd: '/project' },
      cols: 120,
      rows: 500,
    })
  );
});
it('creates independent terminals for concurrent requests without a retained identity', async () => {
  const { service } = fixture();
  const results = await Promise.all([
    service.launch({ kind: 'shell', cwd: '/project' }),
    service.launch({ kind: 'shell', cwd: '/project' }),
  ]);
  expect(new Set(results.map((result) => result.name)).size).toBe(2);
  expect(state.launch).toHaveBeenCalledTimes(2);
});
it('refuses an unknown retained identity instead of launching it', async () => {
  const { service } = fixture();
  await expect(
    service.launch({ sessionName: local, kind: 'shell', cwd: '/project' })
  ).rejects.toThrow('Unknown terminal');
  expect(state.launch).not.toHaveBeenCalled();
});
it('validates the retained local directory and never substitutes a request directory', async () => {
  const { service } = fixture();
  await service.adopt({ name: local, kind: 'agent', path: '/recorded' });
  state.stat.mockClear();
  await service.launch({
    sessionName: local,
    kind: 'shell',
    cwd: '/unrelated',
  });
  expect(state.stat).toHaveBeenCalledExactlyOnceWith('/recorded');
  expect(state.launch).toHaveBeenLastCalledWith(
    expect.objectContaining({ cwd: '/recorded', kind: 'agent' })
  );
  state.stat.mockImplementationOnce(() => {
    throw new Error('ENOENT');
  });
  await expect(
    service.launch({ sessionName: local, kind: 'shell', cwd: '/valid' })
  ).rejects.toThrow('/recorded');
});
it('refuses a concurrent restart with different intent', async () => {
  const { service } = fixture();
  await service.adopt({ name: local, kind: 'agent', path: '/project' });
  const first = service.launch({
    sessionName: local,
    kind: 'agent',
    cwd: '/project',
  });
  await expect(
    service.launch({
      sessionName: local,
      kind: 'agent',
      cwd: '/project',
      fresh: true,
    })
  ).rejects.toThrow('Another launch');
  await first;
});
it('never kills or detaches a terminal this service does not own', () => {
  const { service, ports } = fixture();
  service.stop(local);
  service.forget(local);
  expect(state.kill).not.toHaveBeenCalled();
  expect(state.detach).not.toHaveBeenCalled();
  expect(ports.ended).not.toHaveBeenCalled();
});
it('forgets a stopped terminal and ignores its late client exit', async () => {
  const { service, ports } = fixture();
  await service.adopt({ name: local, kind: 'shell', path: '/project' });
  const exit = state.exits[0];
  service.stop(local);
  exit();
  expect(service.has(local)).toBe(false);
  expect(service.names()).toEqual([]);
  expect(state.kill).toHaveBeenCalledExactlyOnceWith(local);
  expect(ports.ended).toHaveBeenCalledExactlyOnceWith(local);
  expect(state.release).not.toHaveBeenCalled();
});
it('exposes connection health only for remote terminals', async () => {
  const { service } = fixture();
  await service.adopt({ name: local, kind: 'shell', path: '/project' });
  await service.adopt({ name: remote, kind: 'agent', path: '/remote' });
  state.entries.get(local)!.pty.connectionState = 'reconnecting';
  state.entries.get(remote)!.pty.connectionState = 'failed';
  const [localFacts, remoteFacts] = service.list();
  expect(localFacts).not.toHaveProperty('connectionState');
  expect(remoteFacts).toMatchObject({
    machine: 'peer',
    connectionState: 'failed',
  });
});
it('opens a fresh remote terminal where that machine finds the directory, never at this machine’s path', async () => {
  const { service } = fixture();
  // The remote user's home is /home/otheruser; only code/app exists there.
  state.remoteRun.mockImplementation(async (argv: string[]) =>
    argv[4] === 'code/app'
      ? { stdout: '/home/otheruser/code/app\n', stderr: '', code: 0 }
      : { stdout: '', stderr: "sh: 1: cd: can't cd", code: 2 }
  );
  const summary = await service.launch({
    kind: 'shell',
    cwd: join(homedir(), 'code/app'),
    machine: 'peer',
  });
  expect(state.stat).not.toHaveBeenCalled();
  expect(state.remoteRun).toHaveBeenCalledWith(
    ['sh', '-c', 'CDPATH= cd -P -- "$1" && pwd -P', 'sh', 'code/app'],
    { cwd: '~' }
  );
  expect(state.launch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      cwd: '/home/otheruser/code/app',
      machine: 'peer',
    })
  );
  expect(summary).toMatchObject({
    cwd: '/home/otheruser/code/app',
    machine: 'peer',
  });
  await expect(
    service.launch({ kind: 'shell', cwd: '/srv/missing', machine: 'peer' })
  ).rejects.toThrow('Directory does not exist on that machine: /srv/missing');
});
