import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Worktrees and submodules have a .git file; main checkouts have a directory. */
export function isGitRepo(cwd: string): boolean {
  try {
    const entry = statSync(join(cwd, '.git'));
    return entry.isDirectory() || entry.isFile();
  } catch {
    return false;
  }
}

/** Canonical paths agree with Git toplevels, @session-repo tags, worktree
 * origins and tab groups. Every user-selected entry path crosses this boundary. */
export function canonicalRepoPath(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/** Resolve the checkout root from any directory within it. */
export function resolveRepositoryRoot(path: string): string {
  try {
    return canonicalRepoPath(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: path,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim()
    );
  } catch {
    throw new Error(`Not a git repository: ${path}`);
  }
}

/** How long a `rev-parse` may block the caller: it runs synchronously,
 *  on whatever event loop asked, for a directory that may sit on a mount
 *  that no longer answers. */
const REV_PARSE_TIMEOUT_MS = 3_000;

/** `git rev-parse` in `dir`, trimmed; throws outside a repository, or
 *  once Git has taken `REV_PARSE_TIMEOUT_MS`. */
function revParse(dir: string, ...args: string[]): string {
  return execFileSync('git', ['rev-parse', ...args], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: REV_PARSE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  }).trim();
}

/**
 * The main checkout of the repository `dir` is in — the directory
 * itself, a subdirectory or a linked worktree of it — or `null` outside
 * one. Git's common directory is the main checkout's `.git`; a bare
 * repository's is the repository itself. A submodule's lives in its
 * superproject's `.git/modules`, so its checkout is its top level. A
 * Git that does not answer in time answers `null` too.
 */
export function mainCheckoutOf(dir: string): string | null {
  try {
    const common = revParse(dir, '--path-format=absolute', '--git-common-dir');
    if (!common) return null;
    if (basename(common) === '.git') return canonicalRepoPath(dirname(common));
    if (/[\\/]\.git[\\/]modules[\\/]/.test(common))
      return canonicalRepoPath(revParse(dir, '--show-toplevel'));
    return canonicalRepoPath(common);
  } catch {
    return null;
  }
}
