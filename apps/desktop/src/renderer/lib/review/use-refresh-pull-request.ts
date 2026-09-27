import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import { useRefreshRemote } from '../data/mutations.js';
import { keys } from '../data/query-keys.js';
import { errorMessage } from '../utils.js';

/**
 * Refresh one pull request as an action: the list row (reviewers,
 * checks, unresolved count) through the same refresh as the status
 * bar's, then its threads and description. `pending` lasts until all
 * three have been read again.
 *
 * Not the diff: that is git's, read from the last fetch of the branch,
 * and refreshing the pull request does not fetch it.
 */
export function useRefreshPullRequest(cwd: string) {
  const qc = useQueryClient();
  const remote = useRefreshRemote(cwd);
  const [pending, setPending] = useState(false);
  // Each query reports its own failed refetch where it is shown, so
  // these settle without rejecting. The list's refetch is already under
  // way; this waits for it rather than starting another.
  const reread = (pr: PullRequestInfo) =>
    Promise.all([
      qc.invalidateQueries(
        { queryKey: keys.sidebar(cwd) },
        { cancelRefetch: false }
      ),
      qc.invalidateQueries({ queryKey: keys.threads(cwd, pr.id) }),
      qc.invalidateQueries({ queryKey: keys.prDescription(cwd, pr.id) }),
    ]);
  const run = (pr: PullRequestInfo) => {
    setPending(true);
    remote
      .mutateAsync()
      .catch((e: unknown) => toast.error(`Refresh failed: ${errorMessage(e)}`))
      .then(() => reread(pr))
      .catch((e: unknown) => toast.error(errorMessage(e)))
      .finally(() => setPending(false));
  };
  return { run, pending };
}
