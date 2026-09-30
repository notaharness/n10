import {
  computeConflictCounts,
  sweepMergedBranches,
  syncRemote,
} from '@n10/core';
import { listWorktrees } from '@n10/worktree-manager';
import type { WorktreeRemovalCheck, WorktreeRemovalOutcome } from '@n10/core';
import type { ConfigSnapshot } from '../config/config-service.js';
import type { PullRequestList } from '../pull-requests/pull-request-list.js';
import type { SyncNotice } from './sync-snapshot.js';

export async function runSyncPass(options: {
  repo: string;
  config: Pick<ConfigSnapshot, 'config' | 'provider' | 'vcsConfigured'>;
  pullRequests: Pick<PullRequestList, 'getSnapshot'>;
  warned: ReadonlySet<string>;
  cancelled(): boolean;
  remove(
    branch: string,
    approved: WorktreeRemovalCheck
  ): Promise<WorktreeRemovalOutcome>;
  notice(notice: SyncNotice): void;
}) {
  const { repo, config, cancelled, notice } = options;
  const lastGitSyncAt = await syncRemote(repo);
  if (cancelled()) return null;
  const branches = (await listWorktrees(repo))
    .map((w) => w.branch)
    .filter(Boolean);
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
      if (cancelled()) return;
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
  return cancelled() ? null : { merged, conflicts, lastGitSyncAt, nextWarned };
}
