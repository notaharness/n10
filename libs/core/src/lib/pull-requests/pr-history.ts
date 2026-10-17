import {
  describePullRequest,
  isOid,
  readFailure,
  samePullRequest,
  type Oid,
  type PullRequestRef,
  type PullRequestRevisions,
  type ReadOutcome,
} from '@n10/vcs-core';
import { retainRevisions } from './pr-revision-range.js';
import {
  assertSameContext,
  assertSameRepositoryId,
  parseSnapshotRequest,
  type SnapshotRequest,
  type SnapshotSources,
} from './pr-snapshot.js';
import type { Checkpoint, VisitBaselines } from './review-checkpoints.js';

/**
 * What a pull request's history offers a reader to compare against: the
 * provider's record of its heads and of the viewer's latest review, and
 * n10's own record of the viewer's last visit (`review-checkpoints.ts`).
 *
 * Like a snapshot (`pr-snapshot.ts`), an answer is for the repository
 * and account it was asked about, checked before the reads and again
 * after them.
 */

export interface PullRequestHistory {
  /** The ref asked about, carrying the repository id the provider
   *  named — never one only the caller claimed. */
  ref: PullRequestRef;
  viewer: string | null;
  /** The provider's record of the pull request's heads over time. */
  revisions: ReadOutcome<PullRequestRevisions>;
  /** The head of the viewer's latest submitted review; null when they
   *  have not submitted one. A failed read when the provider answered
   *  as some other account than the one n10 acts as. */
  lastReview: ReadOutcome<{ head: Oid; at: string | null } | null>;
  /** The viewer's last visit before this one; null on a first visit. */
  lastVisit: ReadOutcome<Checkpoint | null>;
}

/** A history read belongs to one visit: see `VisitBaselines`. */
export interface HistoryRequest extends SnapshotRequest {
  visitId: string;
}

function parseVisitId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new TypeError('A history read names its visit');
  }
  return value;
}

/** A history request from untrusted input. Throws on anything off. */
export function parseHistoryRequest(value: unknown): HistoryRequest {
  const req = parseSnapshotRequest(value);
  const { visitId } = value as Record<string, unknown>;
  return { ...req, visitId: parseVisitId(visitId) };
}

export interface HistorySources
  extends Pick<SnapshotSources, 'repository' | 'viewer'> {
  /** Absent when the provider keeps no history n10 reads. */
  revisions?: (prId: number) => Promise<PullRequestRevisions>;
  baselines: VisitBaselines;
}

async function readRevisions(
  ref: PullRequestRef,
  read: HistorySources['revisions']
): Promise<ReadOutcome<PullRequestRevisions>> {
  if (!read) {
    return {
      state: 'unsupported',
      reason: 'This provider does not read pull request history',
    };
  }
  try {
    const value = await read(ref.number);
    return samePullRequest({ ...value.ref, id: undefined }, ref)
      ? { state: 'read', value }
      : readFailure(
          new Error(
            `The provider answered about ${describePullRequest(value.ref)}`
          )
        );
  } catch (err) {
    return readFailure(err);
  }
}

/** The last review is the provider's account's: only n10's own counts. */
function lastReviewOf(
  revisions: ReadOutcome<PullRequestRevisions>,
  viewer: string | null
): PullRequestHistory['lastReview'] {
  if (revisions.state !== 'read') return revisions;
  const { viewer: answeredAs, lastReview, reviewsComplete } = revisions.value;
  if (answeredAs?.toLowerCase() !== viewer?.toLowerCase()) {
    return readFailure(
      new Error(
        `The provider answered as ${answeredAs ?? 'an unnamed account'}, not ${
          viewer ?? 'the account n10 acts as'
        }`
      )
    );
  }
  if (lastReview === null) {
    return reviewsComplete
      ? { state: 'read', value: null }
      : readFailure(
          new Error('The viewer’s last review is older than the reviews read')
        );
  }
  const { head, at } = lastReview;
  if (head === null) {
    return readFailure(
      new Error('The provider did not say which revision it was on')
    );
  }
  return { state: 'read', value: { head, at } };
}

/** `ref` carrying exactly the id the provider named, if it named one. */
function confirmedRef(
  ref: PullRequestRef,
  revisions: ReadOutcome<PullRequestRevisions>
): PullRequestRef {
  const out = { ...ref };
  delete out.id;
  const id = revisions.state === 'read' ? revisions.value.ref.id : undefined;
  return id === undefined ? out : { ...out, id };
}

export async function readPullRequestHistory(
  req: HistoryRequest,
  src: HistorySources
): Promise<PullRequestHistory> {
  const viewer = assertSameContext(req, src);
  const revisions = await readRevisions(req.ref, src.revisions);
  // The account and repository may have changed while the read ran.
  assertSameContext({ ...req, viewer }, src);
  assertSameRepositoryId(
    req,
    revisions.state === 'read' ? revisions.value.ref.id : undefined
  );
  const ref = confirmedRef(req.ref, revisions);
  let lastVisit: PullRequestHistory['lastVisit'];
  try {
    const value = src.baselines.lastVisit(ref, viewer, req.visitId);
    lastVisit = { state: 'read', value };
  } catch (err) {
    lastVisit = readFailure(err);
  }
  return {
    ref,
    viewer,
    revisions,
    lastReview: lastReviewOf(revisions, viewer),
    lastVisit,
  };
}

export interface VisitRequest extends HistoryRequest {
  /** The commits the reader was shown. */
  visit: Pick<Checkpoint, 'head' | 'target' | 'mergeBase'>;
  /** The head of the viewer's latest submitted review, as the history
   *  read reported it, to keep alongside the visits; omitted when the
   *  caller does not know it. */
  reviewed?: Oid | null;
}

/** A visit to record, from untrusted input. Throws on anything off. */
export function parseVisitRequest(value: unknown): VisitRequest {
  const req = parseHistoryRequest(value);
  const { visit, reviewed } = value as Record<string, unknown>;
  const { head, target, mergeBase } = (visit ?? {}) as Record<string, unknown>;
  if (!isOid(head) || !isOid(target) || !isOid(mergeBase)) {
    throw new TypeError('A visit names its commits');
  }
  if (reviewed !== undefined && reviewed !== null && !isOid(reviewed)) {
    throw new TypeError('A reviewed head is a commit');
  }
  return {
    ...req,
    visit: { head, target, mergeBase },
    ...(reviewed === undefined ? {} : { reviewed }),
  };
}

export interface VisitSources
  extends Pick<SnapshotSources, 'repository' | 'viewer'> {
  cwd: string;
  baselines: VisitBaselines;
  now?: () => number;
}

/**
 * Record that the reader saw these commits, and keep in the clone every
 * head a later comparison may start from — each visit kept, the frozen
 * baseline, the reviewed head — so a force-push cannot take them. The
 * visit's history read must come first: it is what confirmed the ref
 * the record is kept under (`VisitBaselines.record`).
 */
export async function recordPullRequestVisit(
  req: VisitRequest,
  src: VisitSources
): Promise<void> {
  const viewer = assertSameContext(req, src);
  const at = (src.now ?? Date.now)();
  const kept = src.baselines.record(req.ref, viewer, req.visitId, {
    visit: { ...req.visit, at },
    ...(req.reviewed === undefined ? {} : { reviewed: req.reviewed }),
  });
  const heads: Oid[] = kept.visits.map((v) => v.head);
  if (kept.baseline) heads.push(kept.baseline.head);
  if (kept.reviewed) heads.push(kept.reviewed);
  await retainRevisions(src.cwd, req.ref, viewer, heads);
}
