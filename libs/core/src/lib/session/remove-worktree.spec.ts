import { beforeEach, describe, expect, it, vi } from 'vitest';
import { worktreeSessionKey } from '../session-key.js';
const state = vi.hoisted(() => ({
  calls: [] as unknown[],
  removed: true,
  /** The branch's tip at each read, in order; the last one repeats. */
  tips: ['judged'] as (string | null)[],
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
  branchTip: async () =>
    state.tips.length > 1 ? state.tips.shift() : state.tips[0],
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

const CLEAR = { verdict: 'clear', tip: 'judged' } as const;
const FORCE = {
  verdict: 'force',
  reason: 'uncommitted changes',
  tip: 'judged',
} as const;
const kinds = () => state.calls.map((c) => (c as string[])[0]);

beforeEach(() => {
  state.calls = [];
  state.removed = true;
  state.tips = ['judged'];
  state.alive = new Set();
  state.safety = { safe: true };
});

describe('removeWorktreeSession', () => {
  it('stops only the qualified agent before removing its checkout and branch in the captured repo', async () => {
    await removeWorktreeSession('feature/login', FORCE, '/repo-a');
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
    await removeWorktreeSession('feature/login', CLEAR, '/repo-a');
    expect(state.calls.at(-1)).toEqual(['rescan']);
  });

  it('keeps the branch if checkout removal fails', async () => {
    state.removed = false;
    expect(await removeWorktreeSession('feature/login', CLEAR, '/repo-a')).toBe(
      false
    );
    expect(kinds()).not.toContain('delete');
  });

  it.each([
    ['clear', CLEAR, false],
    ['agent-running', { verdict: 'agent-running', tip: 'judged' }, false],
    ['force', FORCE, true],
  ] as const)(
    'forces only past what a %s verdict confirmed',
    async (_, approved, force) => {
      await removeWorktreeSession('feature/login', approved, '/repo-a');
      expect(state.calls).toContainEqual([
        'remove',
        'feature/login',
        { force, cwd: '/repo-a' },
      ]);
    }
  );

  it('removes nothing for a refused verdict', async () => {
    const refused = {
      verdict: 'refused',
      reason: 'protected branch',
      tip: 'judged',
    } as const;
    expect(
      await removeWorktreeSession('feature/login', refused, '/repo-a')
    ).toBe(false);
    expect(state.calls).toEqual([]);
  });

  // Commits made after the check were never judged.
  it('leaves everything, agent included, once the branch has moved', async () => {
    state.tips = ['later'];
    expect(await removeWorktreeSession('feature/login', CLEAR, '/repo-a')).toBe(
      false
    );
    expect(kinds()).toEqual(['rescan']);
  });

  it('keeps the branch when it moved before its agent stopped', async () => {
    state.tips = ['judged', 'later'];
    await removeWorktreeSession('feature/login', CLEAR, '/repo-a');
    expect(kinds()).toContain('remove');
    expect(kinds()).not.toContain('delete');
  });
});

describe('checkWorktreeRemoval', () => {
  it('is clear when git has nothing to lose and no agent runs', async () => {
    expect(await checkWorktreeRemoval('feature/login', '/repo-a')).toEqual({
      verdict: 'clear',
      tip: 'judged',
    });
  });

  it("asks about the checkout's live agent, found by its path", async () => {
    state.alive.add(LOGIN_KEY);
    expect(await checkWorktreeRemoval('feature/login', '/repo-a')).toEqual({
      verdict: 'agent-running',
      tip: 'judged',
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
        tip: 'judged',
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
        tip: 'judged',
      });
    }
  );
});
