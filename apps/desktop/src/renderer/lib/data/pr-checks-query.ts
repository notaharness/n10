import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  PullRequestChecksAnswer,
  PullRequestRef,
} from '../../../host/contract.js';
import { failureText } from '../review/readiness-model.js';
import { assertEcho, NO_REF } from './pr-snapshot-query.js';
import { keys } from './query-keys.js';

/**
 * What stands between the selected pull request and completion, read by
 * identity like its snapshot: keyed by the provider-qualified pull
 * request, the account and the head, and an answer about another is an
 * error. The readiness and the check list inside it are decided in
 * core; the renderer only shows them.
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

/**
 * A re-read whose checks failed does not replace one whose checks were
 * read: it fails, so the answer on screen stays, marked stale with why.
 * Only where nothing was read before does core's answer from the list
 * row stand in.
 */
export function keepRead(
  answer: PullRequestChecksAnswer,
  prev: PullRequestChecksAnswer | undefined
): PullRequestChecksAnswer {
  if (answer.checks.state === 'failed' && prev?.checks.state === 'read') {
    throw new Error(failureText(answer.checks));
  }
  return answer;
}

/** The same pull request, account and repository at another head. */
export function sameButHead(a: QueryKey | undefined, b: QueryKey): boolean {
  return (
    a != null &&
    JSON.stringify(a.slice(0, -1)) === JSON.stringify(b.slice(0, -1))
  );
}

export function usePullRequestChecks(
  cwd: string,
  ref: PullRequestRef | null,
  viewer: string | null,
  head: string | null
) {
  const qc = useQueryClient();
  const queryKey = keys.prChecks(cwd, ref ?? NO_REF, viewer, head);
  return useQuery({
    queryKey,
    queryFn: async () =>
      keepRead(
        await loadPullRequestChecks(ref!, viewer),
        qc.getQueryData<PullRequestChecksAnswer>(queryKey)
      ),
    enabled: ref != null,
    // Checks move on their own; a refresh, a return or a push reads them
    // again.
    staleTime: 20_000,
    // After a push the last head's answer stays on screen, said to be
    // the last head's, until the new one is read.
    placeholderData: (prev, prevQuery) =>
      sameButHead(prevQuery?.queryKey, queryKey) ? prev : undefined,
  });
}
