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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exec } from './exec.js';

/**
 * `git status` refreshes stale stat data and writes the index back when
 * it can take `index.lock`. n10 runs it in the background, so a user's
 * or agent's `git commit` that starts meanwhile would fail with
 * "index.lock: File exists". Reads through `exec` must leave the index
 * alone.
 */
describe('exec and the index', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'n10-exec-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q', '-b', 'main', '.');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'file.txt'), 'hello\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'initial');
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('leaves a stale index unwritten', async () => {
    const index = join(repo, '.git', 'index');
    const past = new Date('2001-01-01T00:00:00Z');
    utimesSync(join(repo, 'file.txt'), past, past);
    const before = readFileSync(index);

    await exec('git status --porcelain', { encoding: 'utf8', cwd: repo });
    expect(readFileSync(index).equals(before)).toBe(true);

    // The index really was stale: plain git rewrites it.
    const env = { ...process.env };
    delete env.GIT_OPTIONAL_LOCKS;
    execFileSync('git', ['status', '--porcelain'], { cwd: repo, env });
    expect(readFileSync(index).equals(before)).toBe(false);
  });
});
