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
  hasLiveTmuxSession: () => false,
  killPersistedTmuxSession: () => undefined,
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
    const check = await checkWorktreeRemoval('feature', repo);
    expect(check.verdict).toBe('clear');

    expect(await removeWorktreeSession('feature', check, repo)).toBe(true);

    expect(existsSync(worktree)).toBe(false);
    expect(branchExists()).toBe(false);
  });

  it('keeps a commit made after the check', async () => {
    const check = await checkWorktreeRemoval('feature', repo);
    const later = commit(worktree, 'unpushed.txt');

    expect(await removeWorktreeSession('feature', check, repo)).toBe(false);

    expect(existsSync(worktree)).toBe(true);
    expect(git(repo, 'rev-parse', 'feature')).toBe(later);
  });

  it('keeps a file written after a check that found nothing to force', async () => {
    const check = await checkWorktreeRemoval('feature', repo);
    writeFileSync(
      join(worktree, 'draft.txt'),
      'written while the prompt was open'
    );

    expect(await removeWorktreeSession('feature', check, repo)).toBe(false);

    expect(existsSync(join(worktree, 'draft.txt'))).toBe(true);
    expect(branchExists()).toBe(true);
  });

  it('forces past the uncommitted changes the user confirmed', async () => {
    writeFileSync(join(worktree, 'draft.txt'), 'seen in the prompt');
    const check = await checkWorktreeRemoval('feature', repo);
    expect(check).toMatchObject({
      verdict: 'force',
      reason: 'uncommitted changes',
    });

    expect(await removeWorktreeSession('feature', check, repo)).toBe(true);

    expect(existsSync(worktree)).toBe(false);
    expect(branchExists()).toBe(false);
  });
});
