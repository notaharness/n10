import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { describePullRequest, samePullRequest } from '@n10/vcs-core/pr-details';
import type {
  PrComparison,
  PullRequestHistory,
  PullRequestRef,
} from '../../../host/contract.js';
import { pullRequestRefFor } from '../data/pr-snapshot-query.js';
import { keys } from '../data/query-keys.js';
import { useRepo } from '../repo-context.js';
import { errorMessage } from '../utils.js';
import type { HistoryRead } from './revision-model.js';

/**
 * A pull request's revision history (core's `pr-history.ts`) and the
 * reader's visits to it.
 *
 * A visit is this run of the app: the first time the renderer shows the
 * pull request it names a visit, and every read and record until n10
 * quits belongs to it. Its "last visit" is the one before it began,
 * fixed by the host for the visit's whole length, so looking again, a
 * refresh or loading new commits never moves it. The visit is recorded
 * once its diff has reached the screen, not when the history is read.
 */

const visits = new Map<string, string>();

// Session storage outlives a renderer reload — the recovery after a
// crash — but not the app, so a reload stays within the visit.
function stored(key: string): string | null {
  try {
    return sessionStorage.getItem(`n10.visit:${key}`);
  } catch {
    return null;
  }
}

function store(key: string, id: string): void {
  try {
    sessionStorage.setItem(`n10.visit:${key}`, id);
  } catch {
    // Kept in memory for this renderer only.
  }
}

/** The visit `key` (a `pinKey`) belongs to in this run of the app. */
export function visitIdFor(key: string): string {
  let id = visits.get(key) ?? stored(key);
  if (id === null || id === undefined) {
    id = crypto.randomUUID();
    store(key, id);
  }
  visits.set(key, id);
  return id;
}

async function loadHistory(
  cwd: string,
  ref: PullRequestRef,
  viewer: string | null,
  visitId: string
): Promise<PullRequestHistory> {
  const answer = await window.n10.getPullRequestHistory(cwd, {
    ref,
    viewer,
    visitId,
  });
  if (!samePullRequest(answer.ref, ref)) {
    throw new Error(
      `Expected the history of ${describePullRequest(
        ref
      )}, got ${describePullRequest(answer.ref)}’s`
    );
  }
  return answer;
}

const NO_REF: PullRequestRef = {
  provider: '',
  host: '',
  repository: '',
  number: 0,
};

export interface PrHistory {
  read: HistoryRead;
  viewer: string | null;
  visitId: string;
  /** Read the history again. */
  retry: () => void;
}

export function usePrHistory(
  cwd: string,
  prId: number,
  key: string,
  enabled: boolean
): PrHistory {
  const { repo } = useRepo();
  const ref = pullRequestRefFor(repo, prId);
  const viewer = repo.viewer;
  const visitId = visitIdFor(key);
  const query = useQuery({
    queryKey: keys.prHistory(cwd, ref ?? NO_REF, viewer, visitId),
    queryFn: () => loadHistory(cwd, ref!, viewer, visitId),
    enabled: enabled && ref !== null,
    staleTime: 60_000,
  });
  const read: HistoryRead = query.data
    ? { state: 'read', value: query.data }
    : query.error
    ? { state: 'failed', reason: errorMessage(query.error) }
    : ref === null
    ? { state: 'failed', reason: 'no provider is configured' }
    : { state: 'loading' };
  const { refetch } = query;
  // Its outcome lands in the query's own state.
  const retry = useCallback(() => void refetch(), [refetch]);
  return { read, viewer, visitId, retry };
}

/**
 * Record the visit once `comparison`'s diff is on screen and its
 * history read: the host keeps the commits shown, and the reviewed head
 * the history reported, under the pull request that read confirmed.
 */
export function useRecordVisit(
  history: PrHistory,
  comparison: PrComparison | null
) {
  const value = history.read.state === 'read' ? history.read.value : null;
  const review = value?.lastReview;
  const reviewed =
    review?.state === 'read' ? review.value?.head ?? null : undefined;
  const ref = value?.ref ?? null;
  const { viewer, visitId } = history;
  const head = comparison?.headOid;
  const target = comparison?.targetOid;
  const mergeBase = comparison?.mergeBaseOid;
  useEffect(() => {
    if (!ref || !head || !target || !mergeBase) return;
    window.n10
      .recordPullRequestVisit({
        ref,
        viewer,
        visitId,
        visit: { head, target, mergeBase },
        ...(reviewed === undefined ? {} : { reviewed }),
      })
      .catch((e: unknown) =>
        toast.error(`Couldn’t record this visit: ${errorMessage(e)}`, {
          id: `record-visit:${visitId}`,
        })
      );
  }, [ref, viewer, visitId, head, target, mergeBase, reviewed]);
}
