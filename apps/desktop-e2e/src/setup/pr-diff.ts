import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

/**
 * Moving a pull request's branch under the app: the fake `gh` reports
 * the branch's real tip as the pull request's head, so a commit here is
 * a push the provider reports on its next list read.
 */

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Commit a new notes.txt in the branch's worktree; returns its id. */
export function commitOnBranch(
  repoPath: string,
  branch: string,
  text: string
): string {
  const worktree = join(repoPath, '.claude', 'worktrees', branch);
  writeFileSync(join(worktree, 'notes.txt'), text);
  git(worktree, 'commit', '-q', '-am', text);
  return git(worktree, 'rev-parse', 'HEAD');
}

/** Commit a new notes.txt to a branch with no worktree, through a
 *  scratch index; returns its id. */
export function commitWithoutCheckout(
  repoPath: string,
  branch: string,
  text: string
): string {
  const env = {
    ...process.env,
    GIT_INDEX_FILE: join(repoPath, '.git', 'e2e-index'),
  };
  const run = (args: string[], input?: string) =>
    execFileSync('git', args, {
      cwd: repoPath,
      env,
      input,
      encoding: 'utf8',
    }).trim();
  run(['read-tree', branch]);
  const blob = run(['hash-object', '-w', '--stdin'], text);
  run(['update-index', '--cacheinfo', `100644,${blob},notes.txt`]);
  const tree = run(['write-tree']);
  const commit = run(['commit-tree', tree, '-p', branch, '-m', text]);
  run(['update-ref', `refs/heads/${branch}`, commit]);
  return commit;
}

/** Text in the diff pane, not the file tree or a banner. */
export function diffText(page: Page, text: string): Locator {
  return page.locator('[data-diff-scroll]').getByText(text).first();
}
