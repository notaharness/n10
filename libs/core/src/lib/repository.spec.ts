import { afterAll, describe, expect, it } from 'vitest';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isGitRepo, mainCheckoutOf } from './repository.js';

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

  it('gives up on a Git that does not answer, and calls it no repository', () => {
    const bin = join(home, 'hung-bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec sleep 30\n');
    chmodSync(join(bin, 'git'), 0o755);
    const path = process.env['PATH'];
    process.env['PATH'] = `${bin}:${path ?? ''}`;
    try {
      const started = Date.now();
      expect(mainCheckoutOf(home)).toBeNull();
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      process.env['PATH'] = path;
    }
  }, 15_000);
});
