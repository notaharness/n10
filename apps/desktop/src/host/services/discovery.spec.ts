import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionWatchPorts } from '@n10/engine';
import { diffScans } from '@n10/core';

const state = vi.hoisted(() => ({
  cwd: '/repo-a',
  watch: vi.fn(),
  stop: vi.fn(),
  adopt: vi.fn(),
  terminal: vi.fn(),
  forget: vi.fn(),
  guard: vi.fn(),
}));
vi.mock('./repo.js', () => ({
  activeRepository: () => ({
    cwd: state.cwd,
    sessions: { watch: state.watch },
  }),
}));
vi.mock('./session-registry.js', () => ({ adoptSession: state.adopt }));
vi.mock('./sessions.js', () => ({
  defaultPaneSize: () => ({ cols: 120, rows: 40 }),
}));
vi.mock('./machines.js', () => ({
  machines: { refuseIfRemoteOwns: state.guard },
}));
vi.mock('./terminals.js', () => ({
  adoptTerminal: state.terminal,
  forgetTerminal: state.forget,
}));
import {
  setDiscoveryNotifier,
  startDiscoveryForRepo,
  stopDiscovery,
} from './discovery.js';
const ports = () => state.watch.mock.calls.at(-1)![0] as SessionWatchPorts;

beforeEach(() => {
  stopDiscovery();
  setDiscoveryNotifier(null);
  vi.clearAllMocks();
  state.cwd = '/repo-a';
  state.watch.mockReturnValue(state.stop);
});

describe('desktop session observation adapter', () => {
  it('connects adopted sessions to output relays under the captured repository', async () => {
    startDiscoveryForRepo('/repo-a');
    const observed = ports();
    state.cwd = '/repo-b';
    observed.started?.('session', '/repo-a');
    await observed.beforeLaunch?.('branch', 'session');
    expect(state.adopt).toHaveBeenCalledWith('session', '/repo-a');
    expect(state.guard).toHaveBeenCalledWith('/repo-a', 'branch', 'session');
  });

  it('replaces the watch without detaching held sessions', () => {
    startDiscoveryForRepo('/repo-a');
    state.cwd = '/repo-b';
    startDiscoveryForRepo('/repo-b');
    expect(state.stop).toHaveBeenCalledOnce();
    expect(state.watch).toHaveBeenCalledTimes(2);
    stopDiscovery();
    stopDiscovery();
    expect(state.stop).toHaveBeenCalledTimes(2);
  });

  it('ignores an open notification that no longer matches the selected repository', () => {
    startDiscoveryForRepo('/repo-b');
    expect(state.watch).not.toHaveBeenCalled();
  });

  it('leaves detached worktree adoption to shells that can display it', async () => {
    startDiscoveryForRepo('/repo-a');
    await expect(ports().beforeLaunch?.('', 'session')).rejects.toThrow(
      'no branch'
    );
    expect(state.guard).not.toHaveBeenCalled();
  });

  it('routes terminal adoption and ended-terminal notifications to the shell', async () => {
    const notify = vi.fn();
    setDiscoveryNotifier(notify);
    startDiscoveryForRepo('/repo-a');
    const terminal = {
      name: 'terminal',
      kind: 'shell' as const,
      path: '/notes',
    };
    await ports().adoptTerminal?.(terminal);
    expect(state.terminal).toHaveBeenCalledWith(terminal);
    const delta = diffScans(
      { worktrees: [], persisted: new Set(), terminals: [terminal] },
      {
        worktrees: [],
        persisted: new Set(),
        terminals: [],
      },
      () => false
    );
    ports().changed?.(delta);
    expect(state.forget).toHaveBeenCalledWith('terminal');
    expect(notify).toHaveBeenCalledOnce();
  });
});
