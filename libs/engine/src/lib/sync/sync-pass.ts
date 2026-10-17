import type { WorktreeService } from '../worktrees/api.js';
import {
  computeConflictCounts,
  sweepMergedBranches,
  syncRemote,
} from '@n10/core';
import { logError } from '@n10/logger';
import type { WorktreeRemovalCheck, WorktreeRemovalOutcome } from '@n10/core';
import type { ConfigSnapshot } from '../config/api.js';
import type { PullRequestList } from '../pull-requests/api.js';
import type { SyncNotice } from './sync-snapshot.js';

export async function runSyncPass(options: {
  repo: string;
  config: Pick<ConfigSnapshot, 'config' | 'provider' | 'vcsConfigured'>;
  pullRequests: Pick<PullRequestList, 'getSnapshot'>;
  worktrees: Pick<WorktreeService, 'refresh'>;
  warned: ReadonlySet<string>;
  cancelled(): boolean;
  remove(
    branch: string,
    approved: WorktreeRemovalCheck
  ): Promise<WorktreeRemovalOutcome>;
  notice(notice: SyncNotice): void;
}) {
  const { repo, config, cancelled, notice } = options;
  let lastGitSyncAt: number | null = null;
  let error: string | null = null;
  try {
    lastGitSyncAt = await syncRemote(repo);
  } catch (cause) {
    logError('sync fetch', cause);
    error =
      "Couldn't fetch from origin; checking merge status with the provider";
  }
  if (cancelled()) return null;
  if (error) notice({ type: 'failed', repo, error });
  const worktrees = await options.worktrees.refresh();
  if (worktrees.error) throw new Error(worktrees.error);
  const branches = worktrees.worktrees.map((w) => w.branch).filter(Boolean);
  if (cancelled()) return null;
  const { merged, nextWarned } = await sweepMergedBranches({
    ...config,
    branches,
    cwd: repo,
    warnedRebase: options.warned,
    isCancelled: cancelled,
    onAutoDelete: async (branch, approved) => {
      if (cancelled()) return;
      const outcome = await options.remove(branch, approved);
      if (outcome === 'removed' || outcome === 'kept-branch') {
        notice({ type: outcome, repo, branch });
      }
    },
    onRebaseInProgress: (branch) => {
      if (!cancelled()) notice({ type: 'rebase-in-progress', repo, branch });
    },
  });
  if (cancelled()) return null;
  const conflicts = await computeConflictCounts(
    branches.filter((branch) => !merged.has(branch)),
    options.pullRequests.getSnapshot(repo).prMap,
    repo
  );
  return cancelled()
    ? null
    : { merged, conflicts, lastGitSyncAt, nextWarned, error };
}
