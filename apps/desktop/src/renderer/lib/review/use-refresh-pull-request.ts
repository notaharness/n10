import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import { useRefreshRemote } from '../data/mutations.js';
import { keys } from '../data/query-keys.js';
import { errorMessage } from '../utils.js';

/**
 * Refresh one pull request as an action: the list row (reviewers,
 * checks, unresolved count) through the same refresh as the status
 * bar's, then its threads and description.
 *
 * Not the diff: that is git's, read from the last fetch of the branch,
 * and refreshing the pull request does not fetch it.
 */
export function useRefreshPullRequest(cwd: string) {
  const qc = useQueryClient();
  const remote = useRefreshRemote(cwd);
  const run = (pr: PullRequestInfo) =>
    remote.mutate(undefined, {
      onError: (e) => toast.error(`Refresh failed: ${errorMessage(e)}`),
      // Invalidation settles without rejecting; each query reports its
      // own failed refetch where it is shown.
      onSettled: () => {
        void qc.invalidateQueries({ queryKey: keys.threads(cwd, pr.id) });
        void qc.invalidateQueries({ queryKey: keys.prDescription(cwd, pr.id) });
      },
    });
  return { run, pending: remote.isPending };
}
