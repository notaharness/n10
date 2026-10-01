import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isGitRepo } from './repository.js';

const home = mkdtempSync(join(tmpdir(), 'n10-repository-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

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
});
