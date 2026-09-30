import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Host adapters supply repository/watch ports and launch detached editors. */

const calls = vi.hoisted(() => ({
  log: [] as string[],
  removed: 'removed' as string,
  worktrees: [] as { branch: string; path: string }[],
  config: { editor: undefined } as Record<string, unknown>,
  spawned: [] as { cmd: string; args: string[]; detached: boolean }[],
  createReturns: '/repo/.claude/worktrees/b' as string | null,
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => '/repo',
  activeRepoIs: (cwd: string) => cwd === '/repo',
}));

vi.mock('@n10/vcs-core', () => ({ readConfig: () => calls.config }));

vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[], opts: { detached: boolean }) => {
    calls.spawned.push({ cmd, args, detached: opts.detached });
    return { unref: () => undefined };
  },
}));

vi.mock('@n10/core', () => ({
  removeWorktreeSession: (
    branch: string,
    approved: { verdict: string },
    repo: string
  ) => {
    calls.log.push(`remove-session:${repo}:${branch}:${approved.verdict}`);
    return Promise.resolve(calls.removed);
  },
}));

vi.mock('./babysit.js', () => ({
  stopBabysitForBranch: (_repo: string, branch: string) => {
    calls.log.push(`stop-babysit:${branch}`);
    return [42];
  },
  startBabysitForRepo: (_repo: string, prId: number) => {
    calls.log.push(`start-babysit:${prId}`);
    return Promise.resolve({ phase: 'watching' });
  },
}));

vi.mock('@n10/worktree-manager', () => ({
  listWorktrees: () => Promise.resolve(calls.worktrees),
  listBranches: () => Promise.resolve(['main']),
  listAllBranches: () => Promise.resolve(['main', 'origin/main']),
  createWorktree: (branch: string) => {
    calls.log.push(`create:${branch}`);
    return Promise.resolve(calls.createReturns);
  },
  removeWorktree: (branch: string, opts: { force: boolean }) => {
    calls.log.push(`remove:${branch}:${opts.force ? 'force' : 'safe'}`);
    return Promise.resolve(calls.removed);
  },
  canRemoveBranch: () => Promise.resolve({ safe: true }),
  deleteBranch: (branch: string) => {
    calls.log.push(`delete-branch:${branch}`);
    return Promise.resolve(true);
  },
  branchToSessionName: (branch: string) => branch.replace(/\//g, '-'),
  worktreeSessionName: (wt: { branch: string }) =>
    `wt-${wt.branch.replace(/\//g, '-')}`,
}));

const { openInEditor, removeWorktree } = await import('./worktrees.js');

beforeEach(() => {
  calls.log = [];
  calls.removed = 'removed';
  calls.worktrees = [
    { branch: 'feature/x', path: '/repo/.claude/worktrees/feature/x' },
  ];
  calls.config = {};
  calls.spawned = [];
  calls.createReturns = '/repo/.claude/worktrees/b';
  delete process.env.VISUAL;
  delete process.env.EDITOR;
});

describe('removeWorktree', () => {
  it('stops babysitting then delegates removal with the captured repository', async () => {
    expect(
      await removeWorktree('feature/x', {
        verdict: 'force',
        reason: 'uncommitted changes',
        risks: ['uncommitted changes'],
        discardsUncommitted: true,
        tip: 'abc123',
        repo: '/repo/.git',
        checkout: '/repo/wt',
      })
    ).toBe('removed');
    expect(calls.log).toEqual([
      'stop-babysit:feature/x',
      'remove-session:/repo:feature/x:force',
    ]);
  });
});

describe('openInEditor', () => {
  it('refuses when no editor is configured anywhere', async () => {
    await expect(openInEditor('b')).rejects.toThrow('No editor configured');
    expect(calls.spawned).toEqual([]);
  });

  it('prefers the configured editor over the environment', async () => {
    calls.config = { editor: 'code' };
    process.env.VISUAL = 'vim';
    expect(await openInEditor('b')).toEqual({ editor: 'code' });
    expect(calls.spawned[0].cmd).toBe('code');
  });

  it('falls back to VISUAL, then EDITOR', async () => {
    process.env.EDITOR = 'nano';
    expect(await openInEditor('b')).toEqual({ editor: 'nano' });

    process.env.VISUAL = 'vim';
    expect(await openInEditor('b')).toEqual({ editor: 'vim' });
  });

  it('creates the worktree first, so a PR with no checkout still opens', async () => {
    calls.config = { editor: 'code' };
    await openInEditor('b');
    expect(calls.log).toContain('create:b');
    expect(calls.spawned[0].args).toEqual(['/repo/.claude/worktrees/b']);
  });

  it('spawns detached so closing n10 does not close the editor', async () => {
    calls.config = { editor: 'code' };
    await openInEditor('b');
    expect(calls.spawned[0].detached).toBe(true);
  });

  it('reports a worktree it could not resolve', async () => {
    calls.config = { editor: 'code' };
    calls.createReturns = null;
    await expect(openInEditor('b')).rejects.toThrow(
      'Failed to resolve a worktree'
    );
    expect(calls.spawned).toEqual([]);
  });
});
