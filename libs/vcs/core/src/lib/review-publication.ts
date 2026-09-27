import type { LineRange } from './pr-conversation.js';
import type { Oid } from './pr-details.js';

/**
 * Publishing a reviewer's drafts as one native review: the summary,
 * the verdict, and every chosen comment, filed against the commit the
 * reviewer read.
 *
 * A provider write can fail after it took effect, so a publication is
 * a sequence of steps recorded in a ledger the caller keeps. A step
 * whose answer never came is marked `inFlight` and looked for on the
 * provider before it is sent again; nothing is sent twice on the
 * strength of a guess.
 */

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

/** Where a comment in the review goes. */
export type ReviewPlace =
  | { kind: 'line'; path: string; range: LineRange }
  | { kind: 'file'; path: string }
  | { kind: 'reply'; threadId: string };

export interface ReviewItem {
  /** The caller's name for the item; the ledger is keyed by it. */
  key: string;
  body: string;
  place: ReviewPlace;
}

export interface ReviewSubmission {
  prId: number;
  /** The head commit the reviewer read. The review is filed against it,
   *  and refused when the pull request has moved on. */
  head: Oid;
  event: ReviewEvent;
  /** The review's own text; may be empty where the provider allows. */
  body: string;
  items: ReviewItem[];
}

/** What a publication has done so far, across attempts and restarts. */
export interface ReviewLedger {
  /** When this publication first began, to tell its pending review
   *  from one the reviewer started elsewhere. */
  startedAt: number;
  /** The head the pending review was created against. */
  head: Oid;
  /** The provider's pending review, once created. */
  reviewId: string | null;
  /** The step sent whose answer never came: `review`, `submit`, or an
   *  item's key. */
  inFlight: string | null;
  /** Each item already in the pending review: its remote id, and the
   *  text it was added with. */
  added: Record<string, { id: string; body: string }>;
  submitted: boolean;
}

export interface LedgerStore {
  read(): ReviewLedger | null;
  write(ledger: ReviewLedger): void;
}

export interface PublishedReview {
  reviewId: string;
  /** Each item's remote comment id. */
  items: Record<string, string>;
}

/**
 * Why a publication stopped. `refused`: the provider answered no, and
 * nothing of that step was written. `unknown`: a step's answer was
 * lost; it is looked for on the next attempt. `moved`: the pull
 * request's head is not the one reviewed. `blocked`: the reviewer has a
 * pending review of their own on the provider.
 */
export type PublishFailure = 'refused' | 'unknown' | 'moved' | 'blocked';

export class ReviewPublishError extends Error {
  readonly failure: PublishFailure;
  constructor(failure: PublishFailure, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ReviewPublishError';
    this.failure = failure;
  }
}

export function isReviewPublishError(err: unknown): err is ReviewPublishError {
  return err instanceof ReviewPublishError;
}

export function freshLedger(head: Oid, now: number): ReviewLedger {
  return {
    startedAt: now,
    head,
    reviewId: null,
    inFlight: null,
    added: {},
    submitted: false,
  };
}
