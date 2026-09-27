import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BranchRemovalAssessment } from '@n10/worktree-manager';
import { worktreeSessionKey } from '../session-key.js';
const state = vi.hoisted(() => ({
  calls: [] as unknown[],
  removed: true,
  /** The branch's tip at each read, in order; the last one repeats. */
  tips: ['judged'] as (string | null)[],
  rebasing: false,
  alive: new Set<string>(),
  assessment: { refusal: null, risks: [] } as BranchRemovalAssessment,
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
  branchTip: async () => {
    state.calls.push(['tip']);
    return state.tips.length > 1 ? state.tips.shift() : state.tips[0];
  },
  assessBranchRemoval: async () => {
    state.calls.push(['assess']);
    return state.assessment;
  },
  listWorktrees: async () => [
    { branch: 'main', path: '/repo-a' },
    {
      branch: 'feature/login',
      path: '/repo-a/.worktrees/login',
      ...(state.rebasing ? { state: 'rebasing' } : {}),
    },
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
const DIRTY = {
  verdict: 'force',
  reason: 'uncommitted changes',
  risks: ['uncommitted changes'],
  tip: 'judged',
} as const;
const UNPUSHED = {
  verdict: 'force',
  reason: 'not pushed to upstream',
  risks: ['not pushed to upstream'],
  tip: 'judged',
} as const;
const SUBMODULES = {
  verdict: 'force',
  reason: 'populated submodules',
  risks: ['populated submodules'],
  tip: 'judged',
} as const;
/** Each call's kind, without the tip reads. */
const kinds = () =>
  state.calls.map((c) => (c as string[])[0]).filter((kind) => kind !== 'tip');

beforeEach(() => {
  state.calls = [];
  state.removed = true;
  state.tips = ['judged'];
  state.rebasing = false;
  state.alive = new Set();
  state.assessment = { refusal: null, risks: [] };
});

describe('removeWorktreeSession', () => {
  it('stops only the qualified agent before removing its checkout and branch in the captured repo', async () => {
    expect(await removeWorktreeSession('feature/login', DIRTY, '/repo-a')).toBe(
      'removed'
    );
    expect(state.calls.filter((c) => (c as string[])[0] !== 'tip')).toEqual([
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

  it('keeps the branch, and says git refused, if checkout removal fails', async () => {
    state.removed = false;
    expect(await removeWorktreeSession('feature/login', CLEAR, '/repo-a')).toBe(
      'git-refused'
    );
    expect(kinds()).not.toContain('delete');
  });

  // `--force` is git's own guard for files and submodules on disk.
  // Unpushed commits go with the branch, so confirming them must not
  // also take files written after the check.
  it.each([
    ['clear', CLEAR, false],
    ['agent-running', { verdict: 'agent-running', tip: 'judged' }, false],
    ['uncommitted changes', DIRTY, true],
    ['populated submodules', SUBMODULES, true],
    ['not pushed to upstream', UNPUSHED, false],
  ] as const)(
    'forces only past what the verdict confirmed: %s',
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
    ).toBe('refused');
    expect(state.calls).toEqual([]);
  });

  // Commits made after the check were never judged.
  it('leaves everything, agent included, once the branch has moved', async () => {
    state.tips = ['later'];
    expect(await removeWorktreeSession('feature/login', CLEAR, '/repo-a')).toBe(
      'changed'
    );
    expect(kinds()).toEqual(['rescan']);
  });

  // A rebase leaves the branch ref alone until it finishes.
  it('leaves everything once a rebase has started in the checkout', async () => {
    state.rebasing = true;
    expect(await removeWorktreeSession('feature/login', DIRTY, '/repo-a')).toBe(
      'changed'
    );
    expect(kinds()).toEqual(['rescan']);
  });

  it('keeps the branch when it moved before its agent stopped', async () => {
    state.tips = ['judged', 'later'];
    expect(await removeWorktreeSession('feature/login', CLEAR, '/repo-a')).toBe(
      'kept-branch'
    );
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

  // A commit that lands while git is assessing then reads as a moved
  // branch, not as one the verdict covered.
  it('reads the tip before assessing the branch', async () => {
    await checkWorktreeRemoval('feature/login', '/repo-a');
    const order = state.calls.map((c) => (c as string[])[0]);
    expect(order.indexOf('tip')).toBeLessThan(order.indexOf('assess'));
  });

  it("asks about the checkout's live agent, found by its path", async () => {
    state.alive.add(LOGIN_KEY);
    expect(await checkWorktreeRemoval('feature/login', '/repo-a')).toEqual({
      verdict: 'agent-running',
      tip: 'judged',
    });
  });

  it('names every risk the user would be forcing past, even with an agent running', async () => {
    state.assessment = {
      refusal: null,
      risks: ['uncommitted changes', 'not pushed to upstream'],
    };
    state.alive.add(LOGIN_KEY);
    expect(await checkWorktreeRemoval('feature/login', '/repo-a')).toEqual({
      verdict: 'force',
      reason: 'uncommitted changes, not pushed to upstream',
      risks: ['uncommitted changes', 'not pushed to upstream'],
      tip: 'judged',
    });
  });

  it.each(['protected branch', 'rebase in progress'] as const)(
    'refuses %s outright',
    async (refusal) => {
      state.assessment = { refusal, risks: [] };
      expect(await checkWorktreeRemoval('feature/login', '/repo-a')).toEqual({
        verdict: 'refused',
        reason: refusal,
        tip: 'judged',
      });
    }
  );
});
