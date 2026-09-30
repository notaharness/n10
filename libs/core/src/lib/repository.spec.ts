import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  worktreeDir,
  worktreesBasePath,
  resetWorktreeResolver,
} from '@n10/worktree-manager';
import { configureWorktreePath, isGitRepo } from './repository.js';

const home = mkdtempSync(join(tmpdir(), 'n10-repository-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
afterEach(() => resetWorktreeResolver());

describe('repository primitives', () => {
  it('accepts main checkouts and worktree pointers but rejects missing repositories', () => {
    const main = join(home, 'main');
    const worktree = join(home, 'worktree');
    mkdirSync(join(main, '.git'), { recursive: true });
    mkdirSync(worktree);
    writeFileSync(
      join(worktree, '.git'),
      'gitdir: ../main/.git/worktrees/test'
    );
    expect(isGitRepo(main)).toBe(true);
    expect(isGitRepo(worktree)).toBe(true);
    expect(isGitRepo(home)).toBe(false);
  });

  it('resets the worktree template when the next repository has none', () => {
    configureWorktreePath('/first', 'custom/{branch}');
    expect(worktreeDir('topic')).toBe('custom/topic');
    expect(worktreesBasePath()).toBe('/first/custom');
    configureWorktreePath('/second');
    expect(worktreeDir('topic')).toBe('.claude/worktrees/topic');
    expect(worktreesBasePath('/second')).toBe('/second/.claude/worktrees');
  });
});
