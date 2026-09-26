import { beforeEach, describe, expect, it, vi } from 'vitest';
import { worktreeSessionKey } from '../session-key.js';
const state = vi.hoisted(() => ({
  calls: [] as unknown[],
  removed: true,
  alive: new Set<string>(),
  safety: { safe: true } as { safe: true } | { safe: false; reason: string },
}));
vi.mock('../pty-registry.js', () => ({
  hasSession: () => true,
  isSessionAlive: (key: string) => state.alive.has(key),
  killSession: (key: string) => state.calls.push(['kill', key]),
}));
vi.mock('../discovery/session-discovery.js', () => ({
  rescanSessionDiscovery: async () => state.calls.push(['rescan']),
}));
vi.mock('../session-backend.js', () => ({
  killPersistedTmuxSession: (key: string) =>
    state.calls.push(['persisted', key]),
}));
vi.mock('@n10/worktree-manager', () => ({
  canRemoveBranch: async () => state.safety,
  listWorktrees: async () => [
    { branch: 'main', path: '/repo-a' },
    { branch: 'feature/login', path: '/repo-a/.worktrees/login' },
  ],
  removeWorktree: async (branch: string, opts: unknown) => {
    state.calls.push(['remove', branch, opts]);
    return state.removed;
  },
  deleteBranch: async (...args: unknown[]) => {
    state.calls.push(['delete', ...args]);
    return true;
  },
}));
import {
  checkWorktreeRemoval,
  removeWorktreeSession,
} from './remove-worktree.js';

const LOGIN_KEY = worktreeSessionKey('/repo-a/.worktrees/login', '/repo-a');

beforeEach(() => {
  state.calls = [];
  state.removed = true;
  state.alive = new Set();
  state.safety = { safe: true };
});

describe('removeWorktreeSession', () => {
  it('stops only the qualified agent before removing its checkout and branch in the captured repo', async () => {
    await removeWorktreeSession('feature/login', true, '/repo-a');
    expect(state.calls).toEqual([
      ['rescan'],
      ['kill', LOGIN_KEY],
      ['remove', 'feature/login', { force: true, cwd: '/repo-a' }],
      ['delete', 'feature/login', true, '/repo-a'],
      ['rescan'],
    ]);
  });

  // The shells learn of this removal through discovery, as they do of
  // one made outside n10; a failed removal still stopped the agent.
  it('has discovery look again whether or not git removed the checkout', async () => {
    state.removed = false;
    await removeWorktreeSession('feature/login', false, '/repo-a');
    expect(state.calls.at(-1)).toEqual(['rescan']);
  });

  it('keeps the branch if checkout removal fails', async () => {
    state.removed = false;
    expect(await removeWorktreeSession('feature/login', false, '/repo-a')).toBe(
      false
    );
    expect(state.calls.some((c) => (c as string[])[0] === 'delete')).toBe(
      false
    );
  });
});

describe('checkWorktreeRemoval', () => {
  it('is clear when git has nothing to lose and no agent runs', async () => {
    expect(await checkWorktreeRemoval('feature/login', '/repo-a')).toEqual({
      verdict: 'clear',
    });
  });

  it("asks about the checkout's live agent, found by its path", async () => {
    state.alive.add(LOGIN_KEY);
    expect(await checkWorktreeRemoval('feature/login', '/repo-a')).toEqual({
      verdict: 'agent-running',
    });
  });

  it.each(['uncommitted changes', 'not pushed to upstream'])(
    'lets the user force past %s, even with an agent running',
    async (reason) => {
      state.safety = { safe: false, reason };
      state.alive.add(LOGIN_KEY);
      expect(await checkWorktreeRemoval('feature/login', '/repo-a')).toEqual({
        verdict: 'force',
        reason,
      });
    }
  );

  it.each(['protected branch', 'rebase in progress'])(
    'refuses %s outright',
    async (reason) => {
      state.safety = { safe: false, reason };
      expect(await checkWorktreeRemoval('feature/login', '/repo-a')).toEqual({
        verdict: 'refused',
        reason,
      });
    }
  );
});
