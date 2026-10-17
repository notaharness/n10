import { execFileSync } from 'node:child_process';
import { parseDiffFiles } from '@n10/diff';
import type { CommentDiff } from '@n10/review-comments';
import { isBranchName } from './pr-comparison.js';

const DIFF_FLAGS = [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '-M',
];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function commit(cwd: string, rev: string): string | null {
  try {
    return git(cwd, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${rev}^{commit}`,
    ]).trim();
  } catch {
    return null;
  }
}

/** Where HEAD branched off `base`'s tip, remote-tracking ref first. */
function forkPoint(
  cwd: string,
  base: string,
  head: string
): { ok: true; oid: string } | { ok: false; error: string } {
  const tip =
    commit(cwd, `refs/remotes/origin/${base}`) ??
    commit(cwd, `refs/heads/${base}`);
  if (!tip)
    return {
      ok: false,
      error:
        `Branch ${base} was not found in this clone. Run \`git fetch origin ${base}\` ` +
        'and retry, or set --base to the pull request’s target branch.',
    };
  try {
    return { ok: true, oid: git(cwd, ['merge-base', tip, head]).trim() };
  } catch {
    return { ok: false, error: `HEAD and ${base} have no common ancestor.` };
  }
}

/** The paths a diff of `file` names, or null when the diff does not
 *  touch it. A rename names both; a comment goes on its new path. */
function changedPaths(
  cwd: string,
  from: string,
  to: string,
  file: string
): string[] | null {
  const fields = git(cwd, [...DIFF_FLAGS, '--name-status', '-z', from, to])
    .split('\0')
    .filter(Boolean);
  for (let i = 0; i < fields.length; ) {
    const status = fields[i];
    const width = /^[RC]/.test(status) ? 2 : 1;
    const paths = fields.slice(i + 1, i + 1 + width);
    if (paths[paths.length - 1] === file) return paths;
    i += 1 + width;
  }
  return null;
}

/**
 * `file`'s diff in the pull request as this checkout has it: from where
 * HEAD branched off `base` to HEAD, the three-dot diff a provider shows.
 */
export function readCommentDiff(
  cwd: string,
  base: string,
  file: string
): CommentDiff {
  if (!isBranchName(base))
    return { ok: false, error: `"${base}" is not a valid branch name.` };
  const head = commit(cwd, 'HEAD');
  if (!head)
    return {
      ok: false,
      error:
        "No commit is checked out here. Run n10 util add-comment in the pull request's checkout.",
    };
  const from = forkPoint(cwd, base, head);
  if (!from.ok) return from;
  const paths = changedPaths(cwd, from.oid, head, file);
  if (!paths) return { ok: true, head, lines: null };
  const patch = git(cwd, [
    ...DIFF_FLAGS,
    '-U3',
    from.oid,
    head,
    '--',
    ...paths.map((path) => `:(top,literal)${path}`),
  ]);
  const parsed = parseDiffFiles(patch).find((entry) => entry.path === file);
  return { ok: true, head, lines: parsed?.lines ?? [] };
}
