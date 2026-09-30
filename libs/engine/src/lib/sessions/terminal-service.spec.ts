import type * as Fs from 'node:fs';
import type * as Vcs from '@n10/vcs-core';
import { beforeEach, expect, it, vi } from 'vitest';
import type * as Core from '@n10/core';
import { terminalSessionKey } from '@n10/core';
import { createTerminalService } from './terminal-service.js';

const state = vi.hoisted(() => ({
  launch: vi.fn(),
  stat: vi.fn(() => ({ isDirectory: () => true })),
  config: vi.fn((cwd: string) => ({ cwd })),
  persisted: new Set<string>(),
  entries: new Map<string, { pty: { onExit: (cb: () => void) => void } }>(),
  exits: [] as (() => void)[],
  kill: vi.fn(),
  release: vi.fn(),
  detach: vi.fn(),
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
  state.launch
    .mockReset()
    .mockImplementation(async ({ name }: { name?: string }) =>
      register(name ?? local)
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
