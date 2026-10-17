import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCommentDiff } from './agent-comment-diff.js';

/**
 * The diff `n10 util add-comment` checks an anchor against, read from
 * real git: an upstream plays the provider, a clone of it the review
 * agent's checkout on the pull request's branch.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const numbered = (n: number, edit: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => edit[i + 1] ?? `line ${i + 1}`).join(
    '\n'
  ) + '\n';

function commit(dir: string, files: Record<string, string | null>) {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) git(dir, 'rm', '-q', path);
    else writeFileSync(join(dir, path), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'change');
}

function identify(dir: string) {
  git(dir, 'config', 'user.email', 'test@n10.dev');
  git(dir, 'config', 'user.name', 'n10 Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

let root: string;
let checkout: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'n10-comment-diff-'));
  const upstream = join(root, 'upstream');
  mkdirSync(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  identify(upstream);
  mkdirSync(join(upstream, 'src'));
  commit(upstream, {
    'a.ts': numbered(30),
    'old.ts': numbered(40),
    'same.ts': numbered(5),
    'src/deep.ts': numbered(10),
  });
  checkout = join(root, 'checkout');
  git(root, 'clone', '-q', upstream, checkout);
  identify(checkout);
  git(checkout, 'switch', '-q', '-c', 'feature');
  git(checkout, 'mv', 'old.ts', 'new.ts');
  commit(checkout, {
    'a.ts': numbered(30, { 15: 'changed' }),
    'new.ts': numbered(40, { 30: 'renamed and changed' }),
    'src/deep.ts': numbered(10, { 5: 'deep' }),
  });
  // The target moves on after the branch was cut: its change is not
  // the pull request's, and must not count as part of its diff.
  commit(upstream, { 'a.ts': numbered(30, { 2: 'on main' }) });
  git(checkout, 'fetch', '-q', 'origin');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The first and last new-side line of each file's one hunk. */
const rangesOf = (file: string) => {
  const diff = readCommentDiff(checkout, 'main', file);
  if (!diff.ok) throw new Error(diff.error);
  if (!diff.lines) return null;
  const right = diff.lines.flatMap((line) => line.newLine ?? []);
  return [[right[0], right[right.length - 1]]];
};

describe('readCommentDiff', () => {
  it('reads the file at the commit checked out', () => {
    const diff = readCommentDiff(checkout, 'main', 'a.ts');
    expect(diff).toMatchObject({
      ok: true,
      head: git(checkout, 'rev-parse', 'HEAD'),
    });
  });

  it('diffs from where the branch left the target, not its tip', () => {
    expect(rangesOf('a.ts')).toEqual([[12, 18]]);
  });

  it('answers null for a file the pull request leaves alone', () => {
    expect(rangesOf('same.ts')).toBeNull();
  });

  it('reads a renamed file on its new path by its changes alone', () => {
    expect(rangesOf('new.ts')).toEqual([[27, 33]]);
    expect(rangesOf('old.ts')).toBeNull();
  });

  it('takes paths from the top of the repository wherever it runs', () => {
    const diff = readCommentDiff(join(checkout, 'src'), 'main', 'src/deep.ts');
    expect(diff.ok && diff.lines?.length).toBeGreaterThan(0);
  });

  it('says how to get a target branch the clone does not have', () => {
    expect(readCommentDiff(checkout, 'release', 'a.ts')).toEqual({
      ok: false,
      error:
        'Branch release was not found in this clone. Run `git fetch origin release` ' +
        'and retry, or set --base to the pull request’s target branch.',
    });
  });

  it('refuses a base that is not a branch name', () => {
    expect(readCommentDiff(checkout, 'HEAD~1', 'a.ts')).toEqual({
      ok: false,
      error: '"HEAD~1" is not a valid branch name.',
    });
  });
});
