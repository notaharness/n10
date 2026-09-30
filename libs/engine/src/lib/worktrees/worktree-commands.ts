import { checkWorktreeRemoval, removeWorktreeSession } from '@n10/core';
import type { WorktreeRemovalCheck, WorktreeRemovalOutcome } from '@n10/core';
import { logError } from '@n10/logger';

export interface WorktreeWatchers {
  suspend(repo: string, branch: string): number[];
  resume(repo: string, id: number): Promise<unknown>;
  isCurrent(repo: string): boolean;
}

export interface WorktreeCommands {
  checkRemoval(branch: string): Promise<WorktreeRemovalCheck>;
  remove(
    branch: string,
    approved: WorktreeRemovalCheck
  ): Promise<WorktreeRemovalOutcome>;
}

/** Captured-repo commands. Core's verdict checks remain the authority on safety. */
export function createWorktreeCommands(options: {
  repo: string;
  watchers?: WorktreeWatchers;
}): WorktreeCommands {
  const { repo, watchers } = options;
  return {
    checkRemoval: (branch) => checkWorktreeRemoval(branch, repo),
    async remove(branch, approved) {
      const stopped = watchers?.suspend(repo, branch) ?? [];
      const outcome = await removeWorktreeSession(branch, approved, repo);
      const gone = outcome === 'removed' || outcome === 'kept-branch';
      if (!gone && watchers?.isCurrent(repo)) {
        for (const id of stopped) {
          await watchers
            .resume(repo, id)
            .catch((error: unknown) =>
              logError('worktree watcher restart', error)
            );
        }
      }
      return outcome;
    },
  };
}
