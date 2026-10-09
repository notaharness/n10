import type * as WorktreeManager from '@n10/worktree-manager';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../pty-registry.js', () => ({
  isSessionAlive: () => false,
  hasSession: () => false,
}));
vi.mock('../session-backend.js', () => ({
  hasLiveSession: () => false,
  killPersistedSession: () => undefined,
}));
vi.mock('@n10/logger', () => ({
  log: () => undefined,
  logError: () => undefined,
}));

import { resetMainBranchCache } from '@n10/worktree-manager';
import { resetRepoRoot } from '../repo-root.js';
import {
  checkWorktreeRemoval,
  removeWorktreeSession,
} from './remove-worktree.js';

/**
 * Removal against real git. A verdict is read when the prompt opens and
 * acted on when the user confirms; an agent or another terminal can
 * change the worktree in between, and nothing it did then was judged.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commit(cwd: string, file: string): string {
  writeFileSync(join(cwd, file), file);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', file);
  return git(cwd, 'rev-parse', 'HEAD');
}

const originalCwd = process.cwd();
let root: string;
let repo: string;
let worktree: string;

// `feature`, checked out in its own worktree and pushed, so git has
// nothing to lose and the verdict is `clear`.
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'n10-remove-worktree-'));
  repo = join(root, 'repo');
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
  worktree = join(repo, '.claude', 'worktrees', 'feature');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree);
  commit(worktree, 'reviewed.txt');
  git(worktree, 'push', '-q', '-u', 'origin', 'feature');
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

const branchExists = () => git(repo, 'branch', '--list', 'feature') !== '';

describe('removing a worktree as confirmed', () => {
  it('removes a clear worktree and its branch', async () => {
    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    expect(check.verdict).toBe('clear');

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('removed');

    expect(existsSync(worktree)).toBe(false);
    expect(branchExists()).toBe(false);
  });

  it('keeps a commit made after the check', async () => {
    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    const later = commit(worktree, 'unpushed.txt');

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('changed');

    expect(existsSync(worktree)).toBe(true);
    expect(git(repo, 'rev-parse', 'feature')).toBe(later);
  });

  it('keeps a file written after a check that found nothing to force', async () => {
    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    writeFileSync(
      join(worktree, 'draft.txt'),
      'written while the prompt was open'
    );

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('changed');

    expect(existsSync(join(worktree, 'draft.txt'))).toBe(true);
    expect(branchExists()).toBe(true);
  });

  it('forces past the uncommitted changes the user confirmed', async () => {
    writeFileSync(join(worktree, 'draft.txt'), 'seen in the prompt');
    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    expect(check).toMatchObject({
      verdict: 'force',
      reason: 'uncommitted changes',
    });

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('removed');

    expect(existsSync(worktree)).toBe(false);
    expect(branchExists()).toBe(false);
  });

  // The prompt is the user's whole picture of what they agree to lose.
  it('names unpushed commits alongside uncommitted changes', async () => {
    commit(worktree, 'unpushed.txt');
    writeFileSync(join(worktree, 'draft.txt'), 'scratch');

    expect(
      await checkWorktreeRemoval('feature', worktreeScope(repo))
    ).toMatchObject({
      verdict: 'force',
      risks: ['uncommitted changes', 'not pushed to upstream'],
    });
  });

  // Unpushed commits go with the branch; `--force` would only add the
  // files written since the check.
  it('keeps a file written after confirming unpushed commits', async () => {
    commit(worktree, 'unpushed.txt');
    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    expect(check).toMatchObject({
      verdict: 'force',
      risks: ['not pushed to upstream'],
    });
    writeFileSync(join(worktree, 'draft.txt'), 'written after the check');

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('changed');

    expect(existsSync(join(worktree, 'draft.txt'))).toBe(true);
    expect(branchExists()).toBe(true);
  });

  // A rebase leaves the branch ref alone until it finishes: an amended
  // commit at an `edit` stop lives only in the checkout's HEAD.
  it('keeps a checkout that started a rebase after the check', async () => {
    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    execFileSync('git', ['rebase', '-i', 'HEAD~1'], {
      cwd: worktree,
      env: {
        ...process.env,
        GIT_SEQUENCE_EDITOR: "perl -i -pe 's/^pick/edit/'",
      },
      stdio: 'ignore',
    });
    writeFileSync(join(worktree, 'amended.txt'), 'amended');
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '--amend', '-m', 'amended during rebase');

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('changed');

    expect(existsSync(join(worktree, 'amended.txt'))).toBe(true);
  });

  // Git will not remove a checkout with a submodule without `--force`.
  it('asks to force past a checked-out submodule, then removes it', async () => {
    addSubmodule();

    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    expect(check).toMatchObject({
      verdict: 'force',
      risks: ['submodules'],
    });

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('removed');
    expect(existsSync(worktree)).toBe(false);
  });

  // `--force` past a submodule would also take the file.
  it('keeps a file written after confirming a submodule', async () => {
    addSubmodule();
    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    writeFileSync(join(worktree, 'draft.txt'), 'written after the check');

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('changed');

    expect(existsSync(join(worktree, 'draft.txt'))).toBe(true);
  });

  // Git still refuses once the submodule is gone from the branch: its
  // repository stays in the worktree's own `modules` directory.
  it('asks to force past a submodule the branch removed', async () => {
    addSubmodule();
    git(worktree, 'rm', '-q', 'sub');
    git(worktree, 'commit', '-q', '-m', 'drop sub');
    git(worktree, 'push', '-q', 'origin', 'feature');

    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    expect(check).toMatchObject({ verdict: 'force', risks: ['submodules'] });
    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('removed');
  });

  // An agent that clones something into its checkout and commits it
  // leaves a gitlink with no `.gitmodules` entry.
  it('asks to force past a committed repository with no .gitmodules', async () => {
    const nested = join(worktree, 'vendored');
    execFileSync('git', ['init', '-q', '-b', 'main', nested]);
    git(nested, 'config', 'user.email', 'test@example.invalid');
    git(nested, 'config', 'user.name', 'Test');
    git(nested, 'commit', '-q', '--allow-empty', '-m', 'vendored');
    git(worktree, 'add', 'vendored');
    git(worktree, 'commit', '-q', '-m', 'vendor it');
    git(worktree, 'push', '-q', 'origin', 'feature');

    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    expect(check).toMatchObject({ verdict: 'force', risks: ['submodules'] });
    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('removed');
  });

  // A user's `status.showUntrackedFiles=no` must not hide a file the
  // removal would take.
  it('sees an untracked file whatever the repository shows by default', async () => {
    git(repo, 'config', 'status.showUntrackedFiles', 'no');
    writeFileSync(join(worktree, 'draft.txt'), 'untracked');

    expect(
      await checkWorktreeRemoval('feature', worktreeScope(repo))
    ).toMatchObject({
      verdict: 'force',
      risks: ['uncommitted changes'],
    });
  });

  // Another checkout at the same commit is not the one the user judged.
  it('keeps a checkout that replaced the one judged', async () => {
    writeFileSync(join(worktree, 'scratch.txt'), 'seen in the prompt');
    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    expect(check).toMatchObject({ verdict: 'force' });
    git(repo, 'worktree', 'remove', '--force', worktree);
    const other = join(repo, '.claude', 'worktrees', 'feature-again');
    git(repo, 'worktree', 'add', '-q', other, 'feature');
    writeFileSync(join(other, 'draft.txt'), 'never judged');

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('changed');
    expect(existsSync(join(other, 'draft.txt'))).toBe(true);
  });

  // A verdict from another clone at the same commit says nothing here.
  it('keeps a checkout when the verdict came from another repository', async () => {
    const clone = join(root, 'clone');
    execFileSync('git', ['clone', '-q', repo, clone]);
    const cloned = join(clone, 'wt');
    git(
      clone,
      'worktree',
      'add',
      '-q',
      '-b',
      'feature',
      cloned,
      'origin/feature'
    );
    const check = await checkWorktreeRemoval('feature', worktreeScope(clone));
    expect(check.tip).toBe(git(repo, 'rev-parse', 'feature'));

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('changed');
    expect(existsSync(worktree)).toBe(true);
  });

  // `git branch -D` can fail too: a stale ref lock, say.
  it('says the branch was kept when git would not delete it', async () => {
    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    const common = git(
      repo,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir'
    );
    writeFileSync(join(common, 'refs', 'heads', 'feature.lock'), '');

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('kept-branch');
    expect(existsSync(worktree)).toBe(false);
    expect(branchExists()).toBe(true);
  });

  it('keeps a checkout that switched to another branch', async () => {
    const check = await checkWorktreeRemoval('feature', worktreeScope(repo));
    git(worktree, 'switch', '-q', '-c', 'other');

    expect(
      await removeWorktreeSession('feature', check, worktreeScope(repo))
    ).toBe('changed');
    expect(existsSync(worktree)).toBe(true);
    expect(branchExists()).toBe(true);
  });
});

/** Add, commit and push a submodule to `feature`, checked out. */
function addSubmodule(): void {
  const sub = join(root, 'sub');
  execFileSync('git', ['init', '-q', '-b', 'main', sub]);
  git(sub, 'config', 'user.email', 'test@example.invalid');
  git(sub, 'config', 'user.name', 'Test');
  git(sub, 'commit', '-q', '--allow-empty', '-m', 'sub');
  git(
    worktree,
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    '-q',
    sub,
    'sub'
  );
  git(worktree, 'commit', '-q', '-m', 'add sub');
  git(worktree, 'push', '-q', 'origin', 'feature');
}

const { worktreeScope } = await vi.importActual<typeof WorktreeManager>(
  '@n10/worktree-manager'
);
