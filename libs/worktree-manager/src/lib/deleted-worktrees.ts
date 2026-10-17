import { resolve } from 'node:path';
import { log } from '@n10/logger';
import { exec, gitOptions } from './exec.js';
import { assertShellSafeRef } from './refs.js';
import type { WorktreeInfo } from './worktree-list.js';

/**
 * Clear what git still remembers of a worktree that was deleted from
 * disk and would stop `branch` being checked out at `dir`: a
 * registration keeps its branch checked out and its directory taken as
 * far as `git worktree add` is concerned. The checkout is already gone,
 * so nothing on disk is lost; the branch itself is left alone.
 */
export async function clearDeletedWorktrees(
  deleted: readonly WorktreeInfo[],
  branch: string,
  dir: string,
  cwd: string
): Promise<void> {
  const stale = deleted.filter(
    (w) => w.branch === branch || resolve(w.path) === dir
  );
  for (const w of stale) {
    try {
      assertShellSafeRef(w.path, 'worktree path');
      await exec(`git worktree remove "${w.path}"`, gitOptions(cwd));
    } catch (e) {
      log(
        'warn',
        'clearDeletedWorktrees',
        `could not clear the registration of ${w.path}`,
        e
      );
    }
  }
}
