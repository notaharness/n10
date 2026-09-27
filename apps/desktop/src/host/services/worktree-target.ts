import { keyForWorktree } from '@n10/core';
import { listWorktrees, type WorktreeInfo } from '@n10/worktree-manager';

/**
 * The checkout a worktree row's action is for.
 *
 * A row with a checkout sends that checkout's session key (the row's
 * `session.name`), because a detached HEAD has no branch to find it by
 * and a switched one names a different checkout. The key is only ever
 * matched against what git lists for the open repository, so the
 * renderer names a row, never a directory to act in. A row with no
 * checkout yet (a pull request) sends none and is found by its branch.
 */
export async function findWorktreeTarget(
  repo: string,
  branch: string,
  worktree?: string
): Promise<WorktreeInfo | undefined> {
  const listed = await listWorktrees(repo);
  return worktree
    ? listed.find((wt) => keyForWorktree(wt, repo) === worktree)
    : listed.find((wt) => wt.branch === branch);
}
