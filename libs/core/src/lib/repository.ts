import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Worktrees and submodules have a .git file; main checkouts have a directory. */
export function isGitRepo(cwd: string): boolean {
  try {
    const entry = statSync(join(cwd, '.git'));
    return entry.isDirectory() || entry.isFile();
  } catch {
    return false;
  }
}

/** Canonical paths agree with Git toplevels, @orchestra-repo tags, worktree
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
