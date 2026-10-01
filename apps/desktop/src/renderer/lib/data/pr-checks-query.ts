import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { PullRequestInfo } from '@n10/vcs-core/types';
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
    throw new Error(failureText(answer.checks, answer.fetchedAt));
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

/**
 * Whether the last head's answer stands in while this head reads: only
 * for the same pull request, and only until this head's read has failed.
 * After that its own failure shows, and Retry keeps it in place rather
 * than bringing the old head back.
 */
export function keepsLastHead(
  prevKey: QueryKey | undefined,
  key: QueryKey,
  failures: number
): boolean {
  return failures === 0 && sameButHead(prevKey, key);
}

/**
 * The list row's facts readiness rests on, beside the head: its checks'
 * rollup, the reviewers' verdicts and requests, the unresolved count,
 * the draft flag and the target. When one moves at the same head, a
 * check finished, a review landed or was asked for, a thread was
 * resolved, it left draft or was retargeted, so the checks are read again.
 */
export function rowFacts(pr: PullRequestInfo): string {
  const verdicts = (pr.reviewers ?? [])
    .map((r) => `${r.identifier}:${r.decision}:${r.requested ?? ''}`)
    .sort();
  return JSON.stringify([
    pr.buildStatus,
    pr.activeCommentCount,
    verdicts,
    pr.isDraft,
    pr.targetBranch,
  ]);
}

/** The placeholder: the last head's answer, where `keepsLastHead`. */
function lastHeadAnswer(qc: QueryClient, queryKey: QueryKey) {
  return (
    prev: PullRequestChecksAnswer | undefined,
    prevQuery: { queryKey: QueryKey } | undefined
  ): PullRequestChecksAnswer | undefined => {
    const failures = qc.getQueryState(queryKey)?.errorUpdateCount ?? 0;
    return keepsLastHead(prevQuery?.queryKey, queryKey, failures)
      ? prev
      : undefined;
  };
}

/** Reads again when the row's facts move; not on the first render. */
function useRereadOnRowFacts(queryKey: QueryKey, facts: string) {
  const qc = useQueryClient();
  const seen = useRef(facts);
  useEffect(() => {
    if (seen.current === facts) return;
    seen.current = facts;
    // A failed re-read shows where the checks are shown; the invalidation
    // itself settles either way.
    qc.invalidateQueries({ queryKey, exact: true }).catch(() => undefined);
  }, [qc, queryKey, facts]);
}

export function usePullRequestChecks(
  cwd: string,
  ref: PullRequestRef | null,
  viewer: string | null,
  pr: PullRequestInfo
) {
  const qc = useQueryClient();
  const queryKey = keys.prChecks(
    cwd,
    ref ?? NO_REF,
    viewer,
    pr.headSha ?? null
  );
  useRereadOnRowFacts(queryKey, rowFacts(pr));
  return useQuery({
    queryKey,
    queryFn: async () =>
      keepRead(
        await loadPullRequestChecks(ref!, viewer),
        qc.getQueryData<PullRequestChecksAnswer>(queryKey)
      ),
    enabled: ref != null,
    // A push is a new key; a refresh, or the list row moving at the same
    // head, reads them again.
    staleTime: 0,
    // After a push the last head's answer stays on screen, said to be the
    // last head's, until the new one is read.
    placeholderData: lastHeadAnswer(qc, queryKey),
  });
}
