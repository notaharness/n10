import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VcsProvider } from '@n10/vcs-core';

// No agent runs here, so there is none to stop or to keep a branch for.
vi.mock('../pty-registry.js', () => ({
  isSessionAlive: () => false,
  hasSession: () => false,
}));
vi.mock('../session-backend.js', () => ({
  hasLiveTmuxSession: () => false,
  killPersistedTmuxSession: () => undefined,
}));
const logged = vi.hoisted(() => [] as string[]);
vi.mock('@n10/logger', () => ({
  log: () => undefined,
  logError: (_where: string, message: unknown) => logged.push(String(message)),
}));

import { resetMainBranchCache, worktreeScope } from '@n10/worktree-manager';
import { __resetFetchQueueForTests } from './fetch-queue.js';
import { removeWorktreeSession } from '../session/remove-worktree.js';
import { sweepMergedBranches } from './remote-sync.js';

/**
 * Automatic cleanup of merged branches, against real Git, through to
 * the removal itself. A merged pull request says something about the
 * commits it carried, not about a branch name forever: a branch name
 * can be reused after its pull request merged, and deleting it then
 * loses the new work.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commit(dir: string, message: string): string {
  writeFileSync(join(dir, `${message}.txt`), message);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
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
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
  repo = realpathSync(repo);
  worktree = join(repo, '.claude', 'worktrees', 'feature');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree);
  commit(worktree, 'reviewed');
  // A step that ignores its repository lands in the fixture root.
  process.chdir(root);
  resetMainBranchCache();
  __resetFetchQueueForTests();
  logged.length = 0;
});

afterEach(() => {
  process.chdir(originalCwd);
  resetMainBranchCache();
  rmSync(root, { recursive: true, force: true });
});

/** A provider whose one merged pull request, from `feature`, had
 *  `head` at its tip when it merged. */
function mergedAt(head: string): VcsProvider {
  return {
    fetchMergedBranches: () => Promise.resolve(new Map([['feature', [head]]])),
  } as unknown as VcsProvider;
}

async function sweep(provider: VcsProvider): Promise<void> {
  const scope = worktreeScope(repo);
  await sweepMergedBranches({
    provider,
    vcsConfigured: true,
    config: { autoDeleteOnMerge: true, vendorAuth: {}, vendorProject: {} },
    branches: ['feature'],
    warnedRebase: new Set(),
    onAutoDelete: async (branch, approved) => {
      await removeWorktreeSession(branch, approved, scope);
    },
    onRebaseInProgress: () => undefined,
    isCancelled: () => false,
    cwd: repo,
  });
}

/** Commit on `feature`, then reset it back one commit: the checkout is
 *  behind the returned head, as after someone else pushed to it. */
function aheadThenBehind(): string {
  const behind = git(worktree, 'rev-parse', 'HEAD');
  const head = commit(worktree, 'elsewhere');
  git(worktree, 'reset', '-q', '--hard', behind);
  return head;
}

/** Drop every trace of `commit` from the clone. */
function forget(commit: string): void {
  git(repo, 'reflog', 'expire', '--expire=now', '--all');
  git(repo, 'gc', '-q', '--prune=now');
  expect(() => git(repo, 'cat-file', '-e', commit)).toThrow();
}

describe('merged-branch cleanup', () => {
  it('removes a worktree whose branch is still the merged head', async () => {
    await sweep(mergedAt(git(worktree, 'rev-parse', 'HEAD')));
    expect(existsSync(worktree)).toBe(false);
    expect(git(repo, 'branch', '--list', 'feature')).toBe('');
  });

  it('keeps a reused branch that took new commits after its pull request merged', async () => {
    const merged = git(worktree, 'rev-parse', 'HEAD');
    const later = commit(worktree, 'after-the-merge');

    await sweep(mergedAt(merged));

    expect(existsSync(worktree)).toBe(true);
    expect(git(repo, 'rev-parse', 'feature')).toBe(later);
    expect(logged).toContain(
      'Skipping auto-delete of feature: it has commits its merged pull request did not'
    );
  });

  // Someone pushed to the pull request after this checkout last pulled:
  // everything local is in what merged.
  it('removes a branch that is behind the merged head', async () => {
    await sweep(mergedAt(aheadThenBehind()));
    expect(existsSync(worktree)).toBe(false);
  });

  // The pull request's last commit was made on the server (Update
  // branch, a committed suggestion) and the branch deleted on merge: no
  // local ref reaches the head, but the remote still has it.
  it('fetches a merged head the clone lacks, then removes a branch behind it', async () => {
    const origin = join(root, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    git(repo, 'remote', 'add', 'origin', origin);
    const merged = aheadThenBehind();
    git(worktree, 'push', '-q', 'origin', `${merged}:refs/heads/feature`);
    // Pruned after the merge deleted the branch.
    git(repo, 'update-ref', '-d', 'refs/remotes/origin/feature');
    forget(merged);

    await sweep(mergedAt(merged));

    expect(existsSync(worktree)).toBe(false);
  });

  // Not knowing is not the same as knowing the branch is covered.
  it('keeps a branch whose merged head it cannot get, and says why', async () => {
    const merged = aheadThenBehind();
    forget(merged);

    await sweep(mergedAt(merged));

    expect(existsSync(worktree)).toBe(true);
    expect(logged).toContain(
      'Skipping auto-delete of feature: the head of its merged pull request is not in this clone'
    );
  });
});
