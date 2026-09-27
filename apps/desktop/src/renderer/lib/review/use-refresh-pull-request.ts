import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import { keys } from '../data/query-keys.js';

/**
 * Refresh one pull request as an action: the list row (reviewers,
 * checks, unresolved count), its threads, its description and its
 * diff. Each entry refetches only where something shows it.
 *
 * The list is re-read even if the host's own read fails, so what the
 * pane shows is never older than the click; the host's failure is still
 * what the returned promise reports.
 */
export function useRefreshPullRequest(cwd: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, PullRequestInfo>({
    mutationFn: () => window.n10.refreshRemote(),
    onSettled: (_r, _e, pr) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.sidebar(cwd) }),
        qc.invalidateQueries({ queryKey: keys.sync(cwd) }),
        qc.invalidateQueries({ queryKey: keys.threads(cwd, pr.id) }),
        qc.invalidateQueries({ queryKey: keys.prDescription(cwd, pr.id) }),
        qc.invalidateQueries({
          queryKey: keys.diff(cwd, pr.sourceBranch, pr.targetBranch),
        }),
      ]),
  });
}
