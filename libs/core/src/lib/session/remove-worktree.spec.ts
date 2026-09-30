import type * as WorktreeManager from '@n10/worktree-manager';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BranchRemovalAssessment,
  WorktreeScope,
} from '@n10/worktree-manager';
import { worktreeSessionKey } from '../session-key.js';
const state = vi.hoisted(() => ({
  calls: [] as unknown[],
  removed: true,
  /** The branch's tip at each read, in order; the last one repeats. */
  tips: ['judged'] as (string | null)[],
  alive: new Set<string>(),
  assessment: { refusal: null, risks: [] } as BranchRemovalAssessment,
  repository: '/repo-a/.git',
  branchDeleted: true,
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
    { branch: 'feature/login', path: '/repo-a/.worktrees/login' },
  ],
  removeWorktree: async (
    branch: string,
    scope: WorktreeScope,
    opts: { force: boolean }
  ) => {
    state.calls.push(['remove', branch, { ...opts, cwd: scope.cwd }]);
    return state.removed;
  },
  deleteBranch: async (...args: unknown[]) => {
    state.calls.push(['delete', ...args]);
    return state.branchDeleted;
  },
  repositoryOf: async () => state.repository,
}));
import {
  checkWorktreeRemoval,
  removeWorktreeSession,
} from './remove-worktree.js';

const LOGIN_KEY = worktreeSessionKey('/repo-a/.worktrees/login', '/repo-a');

/** Where every verdict here was judged. */
const AT = {
  tip: 'judged',
  repo: '/repo-a/.git',
  checkout: '/repo-a/.worktrees/login',
} as const;

const CLEAR = { verdict: 'clear', ...AT } as const;
const DIRTY = {
  verdict: 'force',
  reason: 'uncommitted changes',
  risks: ['uncommitted changes'],
  discardsUncommitted: true,
  ...AT,
} as const;
const UNPUSHED = {
  verdict: 'force',
  reason: 'not pushed to upstream',
  risks: ['not pushed to upstream'],
  discardsUncommitted: false,
  ...AT,
} as const;
const SUBMODULES = {
  verdict: 'force',
  reason: 'submodules',
  risks: ['submodules'],
  discardsUncommitted: true,
  ...AT,
} as const;
/** Each call, without the reads that judge the checkout. */
const effects = () =>
  state.calls.filter((c) => !['tip', 'assess'].includes((c as string[])[0]));
const kinds = () => effects().map((c) => (c as string[])[0]);

beforeEach(() => {
  state.calls = [];
  state.removed = true;
  state.tips = ['judged'];
  state.alive = new Set();
  state.assessment = { refusal: null, risks: [] };
  state.repository = '/repo-a/.git';
  state.branchDeleted = true;
});

describe('removeWorktreeSession', () => {
  it('stops only the qualified agent before removing its checkout and branch in the captured repo', async () => {
    expect(
      await removeWorktreeSession(
        'feature/login',
        DIRTY,
        worktreeScope('/repo-a')
      )
    ).toBe('removed');
    expect(effects()).toEqual([
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
    await removeWorktreeSession(
      'feature/login',
      CLEAR,
      worktreeScope('/repo-a')
    );
    expect(state.calls.at(-1)).toEqual(['rescan']);
  });

  it('keeps the branch, and says git refused, if checkout removal fails', async () => {
    state.removed = false;
    expect(
      await removeWorktreeSession(
        'feature/login',
        CLEAR,
        worktreeScope('/repo-a')
      )
    ).toBe('git-refused');
    expect(kinds()).not.toContain('delete');
  });

  // `--force` is git's own guard for files and submodules on disk.
  // Unpushed commits go with the branch, so confirming them must not
  // also take files written after the check.
  it.each([
    ['clear', CLEAR, false],
    ['agent-running', { verdict: 'agent-running', ...AT }, false],
    ['uncommitted changes', DIRTY, true],
    ['submodules', SUBMODULES, true],
    ['not pushed to upstream', UNPUSHED, false],
  ] as const)(
    'forces only past what the verdict confirmed: %s',
    async (_, approved, force) => {
      await removeWorktreeSession(
        'feature/login',
        approved,
        worktreeScope('/repo-a')
      );
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
      ...AT,
    } as const;
    expect(
      await removeWorktreeSession(
        'feature/login',
        refused,
        worktreeScope('/repo-a')
      )
    ).toBe('refused');
    expect(state.calls).toEqual([]);
  });

  // Commits made after the check were never judged.
  it('leaves everything, agent included, once the branch has moved', async () => {
    state.tips = ['later'];
    expect(
      await removeWorktreeSession(
        'feature/login',
        CLEAR,
        worktreeScope('/repo-a')
      )
    ).toBe('changed');
    expect(kinds()).toEqual(['rescan']);
  });

  // A rebase leaves the branch ref alone until it finishes.
  it('leaves everything once a rebase has started in the checkout', async () => {
    state.assessment = { refusal: 'rebase in progress', risks: [] };
    expect(
      await removeWorktreeSession(
        'feature/login',
        DIRTY,
        worktreeScope('/repo-a')
      )
    ).toBe('changed');
    expect(kinds()).toEqual(['rescan']);
  });

  // `--force` is all or nothing: past a submodule it also takes a file
  // written since the check, which nobody agreed to lose.
  it.each([
    ['clear', CLEAR, 'uncommitted changes'],
    ['submodules', SUBMODULES, 'uncommitted changes'],
    ['unpushed commits', UNPUSHED, 'submodules'],
  ] as const)(
    'leaves everything, agent included, for a %s verdict once git finds %s',
    async (_, approved, risk) => {
      state.assessment = { refusal: null, risks: [risk] };
      expect(
        await removeWorktreeSession(
          'feature/login',
          approved,
          worktreeScope('/repo-a')
        )
      ).toBe('changed');
      expect(kinds()).toEqual(['rescan']);
    }
  );

  it('forces past what the verdict named', async () => {
    state.assessment = { refusal: null, risks: ['uncommitted changes'] };
    expect(
      await removeWorktreeSession(
        'feature/login',
        DIRTY,
        worktreeScope('/repo-a')
      )
    ).toBe('removed');
  });

  // The agent can commit until it stops.
  it('keeps everything when the branch moved while its agent stopped', async () => {
    state.tips = ['judged', 'later'];
    expect(
      await removeWorktreeSession(
        'feature/login',
        CLEAR,
        worktreeScope('/repo-a')
      )
    ).toBe('changed');
    expect(kinds()).toEqual(['rescan', 'kill', 'rescan']);
  });

  it('keeps the branch when it moved during the removal', async () => {
    state.tips = ['judged', 'judged', 'later'];
    expect(
      await removeWorktreeSession(
        'feature/login',
        CLEAR,
        worktreeScope('/repo-a')
      )
    ).toBe('kept-branch');
    expect(kinds()).toContain('remove');
    expect(kinds()).not.toContain('delete');
  });

  // Same branch, same commit, but not what the user judged.
  it('leaves everything when the verdict was about another checkout', async () => {
    const elsewhere = { ...CLEAR, checkout: '/repo-a/.worktrees/other' };
    expect(
      await removeWorktreeSession(
        'feature/login',
        elsewhere,
        worktreeScope('/repo-a')
      )
    ).toBe('changed');
    expect(kinds()).toEqual(['rescan']);
  });

  it('leaves everything when the verdict came from another repository', async () => {
    state.repository = '/clone/.git';
    expect(
      await removeWorktreeSession(
        'feature/login',
        CLEAR,
        worktreeScope('/repo-a')
      )
    ).toBe('changed');
    expect(kinds()).toEqual(['rescan']);
  });

  it('says the branch was kept when git would not delete it', async () => {
    state.branchDeleted = false;
    expect(
      await removeWorktreeSession(
        'feature/login',
        CLEAR,
        worktreeScope('/repo-a')
      )
    ).toBe('kept-branch');
  });

  // A checkout that switched away, or went detached, no longer holds
  // the branch the prompt was about.
  it('leaves everything once no checkout has the branch', async () => {
    expect(
      await removeWorktreeSession(
        'feature/gone',
        CLEAR,
        worktreeScope('/repo-a')
      )
    ).toBe('changed');
    expect(kinds()).toEqual(['rescan']);
  });
});

describe('checkWorktreeRemoval', () => {
  it('is clear when git has nothing to lose and no agent runs', async () => {
    expect(
      await checkWorktreeRemoval('feature/login', worktreeScope('/repo-a'))
    ).toEqual({
      verdict: 'clear',
      ...AT,
    });
  });

  // A commit that lands while git is assessing then reads as a moved
  // branch, not as one the verdict covered.
  it('reads the tip before assessing the branch', async () => {
    await checkWorktreeRemoval('feature/login', worktreeScope('/repo-a'));
    const order = state.calls.map((c) => (c as string[])[0]);
    expect(order.indexOf('tip')).toBeLessThan(order.indexOf('assess'));
  });

  it("asks about the checkout's live agent, found by its path", async () => {
    state.alive.add(LOGIN_KEY);
    expect(
      await checkWorktreeRemoval('feature/login', worktreeScope('/repo-a'))
    ).toEqual({
      verdict: 'agent-running',
      ...AT,
    });
  });

  it('names every risk the user would be forcing past, even with an agent running', async () => {
    state.assessment = {
      refusal: null,
      risks: ['uncommitted changes', 'not pushed to upstream'],
    };
    state.alive.add(LOGIN_KEY);
    expect(
      await checkWorktreeRemoval('feature/login', worktreeScope('/repo-a'))
    ).toEqual({
      verdict: 'force',
      reason: 'uncommitted changes, not pushed to upstream',
      risks: ['uncommitted changes', 'not pushed to upstream'],
      discardsUncommitted: true,
      ...AT,
    });
  });

  // Unpushed commits go with the branch; only what `--force` takes
  // warrants the prompt saying so.
  it('does not warn of discarded changes for unpushed commits alone', async () => {
    state.assessment = { refusal: null, risks: ['not pushed to upstream'] };
    expect(
      await checkWorktreeRemoval('feature/login', worktreeScope('/repo-a'))
    ).toMatchObject({ verdict: 'force', discardsUncommitted: false });
  });

  it.each(['protected branch', 'rebase in progress'] as const)(
    'refuses %s outright',
    async (refusal) => {
      state.assessment = { refusal, risks: [] };
      expect(
        await checkWorktreeRemoval('feature/login', worktreeScope('/repo-a'))
      ).toEqual({
        verdict: 'refused',
        reason: refusal,
        ...AT,
      });
    }
  );
});

const { worktreeScope } = await vi.importActual<typeof WorktreeManager>(
  '@n10/worktree-manager'
);
