import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VcsProvider } from '@n10/vcs-core';

vi.mock('../pty-registry.js', () => ({
  isSessionAlive: () => false,
  hasSession: () => false,
}));
vi.mock('../session-backend.js', () => ({
  hasLiveTmuxSession: () => false,
  killPersistedTmuxSession: () => undefined,
}));
vi.mock('@n10/logger', () => ({
  log: () => undefined,
  logError: () => undefined,
}));

import { resetMainBranchCache } from '@n10/worktree-manager';
import { resetRepoRoot } from '../repo-root.js';
import { removeWorktreeSession } from '../session/remove-worktree.js';
import { sweepMergedBranches } from './remote-sync.js';

/**
 * Automatic cleanup of merged branches, against real git. A merged pull
 * request says something about the commits it carried, not about a
 * branch name forever: a branch can take new work after its pull
 * request merged, and deleting it then loses that work.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const originalCwd = process.cwd();
let root: string;
let repo: string;
let worktree: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'n10-merged-cleanup-'));
  repo = join(root, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
  worktree = join(repo, '.claude', 'worktrees', 'feature');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree);
  writeFileSync(join(worktree, 'reviewed.txt'), 'the pull request');
  git(worktree, 'add', '.');
  git(worktree, 'commit', '-q', '-m', 'reviewed work');
  process.chdir(repo);
  resetRepoRoot();
  resetMainBranchCache();
});

afterEach(() => {
  process.chdir(originalCwd);
  resetRepoRoot();
  resetMainBranchCache();
  rmSync(root, { recursive: true, force: true });
});

/** A provider whose one merged pull request, from `feature`, had
 *  `head` at its tip when it merged. */
function mergedAt(head: string): VcsProvider {
  return {
    fetchMergedBranches: async () => new Map([['feature', [head]]]),
  } as unknown as VcsProvider;
}

async function sweep(provider: VcsProvider): Promise<void> {
  await sweepMergedBranches({
    provider,
    vcsConfigured: true,
    config: { autoDeleteOnMerge: true, vendorAuth: {}, vendorProject: {} },
    branches: ['feature'],
    warnedRebase: new Set(),
    onAutoDelete: async (_session, branch, approved) => {
      await removeWorktreeSession(branch, approved, repo);
    },
    onRebaseInProgress: () => undefined,
  });
}

describe('merged-branch cleanup', () => {
  it('removes a worktree whose branch is still the merged head', async () => {
    await sweep(mergedAt(git(worktree, 'rev-parse', 'HEAD')));
    expect(existsSync(worktree)).toBe(false);
    expect(git(repo, 'branch', '--list', 'feature')).toBe('');
  });

  it('keeps a branch that took new commits after its pull request merged', async () => {
    const merged = git(worktree, 'rev-parse', 'HEAD');
    writeFileSync(join(worktree, 'later.txt'), 'work after the merge');
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', 'unpushed work');
    const later = git(worktree, 'rev-parse', 'HEAD');

    await sweep(mergedAt(merged));

    expect(existsSync(worktree)).toBe(true);
    expect(git(repo, 'rev-parse', 'feature')).toBe(later);
  });

  // Someone pushed to the pull request after this checkout last pulled:
  // everything local is in what merged.
  it('removes a branch that is behind the merged head', async () => {
    const behind = git(worktree, 'rev-parse', 'HEAD');
    writeFileSync(join(worktree, 'pushed.txt'), 'a commit from elsewhere');
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', 'pushed from elsewhere');
    const merged = git(worktree, 'rev-parse', 'HEAD');
    git(worktree, 'reset', '-q', '--hard', behind);

    await sweep(mergedAt(merged));

    expect(existsSync(worktree)).toBe(false);
  });
});
