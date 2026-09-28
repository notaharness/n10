import { useQuery } from '@tanstack/react-query';
import type {
  PullRequestChecksAnswer,
  PullRequestRef,
} from '../../../host/contract.js';
import { assertEcho, NO_REF } from './pr-snapshot-query.js';
import { keys } from './query-keys.js';

/**
 * What stands between the selected pull request and completion, read by
 * identity like its snapshot: keyed by the provider-qualified pull
 * request and the account, and an answer about another is an error.
 * The readiness and the check list inside it are decided in core; the
 * renderer only shows them.
 */
export async function loadPullRequestChecks(
  ref: PullRequestRef,
  viewer: string | null
): Promise<PullRequestChecksAnswer> {
  return assertEcho(
    await window.n10.getPullRequestChecks({ ref, viewer }),
    ref,
    viewer
  );
}

export function usePullRequestChecks(
  cwd: string,
  ref: PullRequestRef | null,
  viewer: string | null
) {
  return useQuery({
    queryKey: keys.prChecks(cwd, ref ?? NO_REF, viewer),
    queryFn: () => loadPullRequestChecks(ref!, viewer),
    enabled: ref != null,
    // Checks move on their own; a refresh or a return reads them again.
    staleTime: 20_000,
  });
}
