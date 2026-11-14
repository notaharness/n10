import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitLine, runGit } from './git-run.js';

/**
 * The ceiling is a stop, not an error.
 *
 * `execFile` throws away everything it read the moment the output
 * exceeds its buffer, and hands the caller
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` instead. That is the failure the
 * worktree diff kept hitting, so the contract worth pinning here is the
 * opposite one: what arrived is returned, and the caller is told it is a
 * prefix.
 */

let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'n10-git-run-'));
  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repo,
  });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  writeFileSync(join(repo, 'file.txt'), `${'y'.repeat(79)}\n`.repeat(4000));
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repo });
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('runGit', () => {
  it('returns the whole output when it fits', async () => {
    const { text, truncated } = await runGit(['show', '--stat', 'HEAD'], {
      cwd: repo,
      maxBytes: 1024 * 1024,
    });
    expect(truncated).toBe(false);
    expect(text).toContain('file.txt');
  });

  it('stops at the ceiling and keeps what it read', async () => {
    const { text, truncated } = await runGit(['show', 'HEAD:file.txt'], {
      cwd: repo,
      maxBytes: 500,
    });
    expect(truncated).toBe(true);
    expect(text).toHaveLength(500);
    expect(text.startsWith('yyy')).toBe(true);
  });

  it('does not call output that lands exactly on the ceiling truncated', async () => {
    // Off by one here is not cosmetic: the caller answers `truncated`
    // by trimming its last complete file away and appending a note
    // saying the diff was cut short, for a diff that was whole.
    const whole = await runGit(['show', 'HEAD:file.txt'], {
      cwd: repo,
      maxBytes: 1024 * 1024,
    });
    const exact = await runGit(['show', 'HEAD:file.txt'], {
      cwd: repo,
      maxBytes: Buffer.byteLength(whole.text),
    });
    expect(exact).toEqual({ text: whole.text, truncated: false });
  });

  it('hands git its input on stdin', async () => {
    const head = await gitLine(['rev-parse', 'HEAD'], { cwd: repo });
    const { text } = await runGit(['cat-file', '--batch-check'], {
      cwd: repo,
      maxBytes: 1024,
      input: `${head}\n`,
    });
    expect(text).toMatch(new RegExp(`^${head} commit \\d+\\n$`));
  });

  it('rejects with git’s own complaint when the command really fails', async () => {
    await expect(
      runGit(['rev-parse', '--verify', 'no-such-ref'], {
        cwd: repo,
        maxBytes: 1024,
      })
    ).rejects.toThrow(/rev-parse failed/);
  });

  it('rejects when git is not looking at a repository', async () => {
    await expect(
      runGit(['status'], { cwd: tmpdir(), maxBytes: 1024 })
    ).rejects.toThrow();
  });
});

describe('gitLine', () => {
  it('trims the trailing newline off a one-line answer', async () => {
    const sha = await gitLine(['rev-parse', 'HEAD'], { cwd: repo });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

/**
 * A read must not write the index. `git status` and `git diff` refresh
 * stale stat data and write the index back when they can take
 * `index.lock`, and a user's or agent's `git commit` that starts while
 * n10 holds it fails with "index.lock: File exists".
 */
describe('runGit and the index', () => {
  it('leaves a stale index unwritten', async () => {
    const index = join(repo, '.git', 'index');
    const past = new Date('2001-01-01T00:00:00Z');
    utimesSync(join(repo, 'file.txt'), past, past);
    const before = readFileSync(index);

    await runGit(['status', '--porcelain'], { cwd: repo, maxBytes: 1024 });
    await runGit(['diff', '--numstat', 'HEAD'], { cwd: repo, maxBytes: 1024 });
    expect(readFileSync(index).equals(before)).toBe(true);

    // The index really was stale: plain git rewrites it.
    const env = { ...process.env };
    delete env.GIT_OPTIONAL_LOCKS;
    execFileSync('git', ['status', '--porcelain'], { cwd: repo, env });
    expect(readFileSync(index).equals(before)).toBe(false);
  });
});
