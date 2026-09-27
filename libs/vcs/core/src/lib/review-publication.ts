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

/**
 * The verdict filed with the review, in each provider's own terms.
 * `COMMENT` leaves the verdict as it is. GitHub takes `APPROVE` and
 * `REQUEST_CHANGES`; Azure DevOps takes its votes: `APPROVE` (10),
 * `APPROVE_WITH_SUGGESTIONS` (5), `WAIT_FOR_AUTHOR` (-5), `REJECT`
 * (-10) and `RESET_VOTE` (0). A provider refuses one it does not have
 * before anything is sent.
 */
export type ReviewEvent =
  | 'COMMENT'
  | 'APPROVE'
  | 'REQUEST_CHANGES'
  | 'APPROVE_WITH_SUGGESTIONS'
  | 'WAIT_FOR_AUTHOR'
  | 'REJECT'
  | 'RESET_VOTE';

export const REVIEW_EVENTS: readonly ReviewEvent[] = [
  'COMMENT',
  'APPROVE',
  'REQUEST_CHANGES',
  'APPROVE_WITH_SUGGESTIONS',
  'WAIT_FOR_AUTHOR',
  'REJECT',
  'RESET_VOTE',
];

/** Verdicts that ask the author for changes: a review filing one says
 *  what, in a summary or a comment. */
export const CHANGES_EVENTS: readonly ReviewEvent[] = [
  'REQUEST_CHANGES',
  'WAIT_FOR_AUTHOR',
  'REJECT',
];

/** Where a comment in the review goes. */
export type ReviewPlace =
  | { kind: 'line'; path: string; range: LineRange }
  | { kind: 'file'; path: string }
  | { kind: 'reply'; threadId: string };

/** Where a step wrote: an item's place, or the conversation, where
 *  Azure DevOps posts the review's summary as a thread of its own. */
export type SentPlace = ReviewPlace | { kind: 'conversation' };

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
  /** The head the pending review was created against. */
  head: Oid;
  /** The provider's pending review, once created. */
  reviewId: string | null;
  /** The step sent whose answer never came: `review`, `discard`,
   *  `submit`, `drop:<key>`, or an item's key. */
  inFlight: string | null;
  /** What that item step was adding, to find it in the pending review
   *  even when its draft has since been deselected. */
  sending: { body: string; place: SentPlace } | null;
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
  /** The provider's review, where it has one (GitHub); Azure DevOps
   *  files comments and a vote, not a review. */
  reviewId: string | null;
  /** Each item in the filed review, by key, with its remote comment id. */
  items: Record<string, string>;
  /** The review had already been filed, by an earlier attempt whose
   *  answer was lost or by the reviewer on the provider, as the
   *  provider holds it: its state and text. Nothing of this request
   *  was sent; `items` is what that review holds. */
  resumed: FiledReview | null;
}

export interface FiledReview {
  /** The provider's state for the review, e.g. GitHub's `APPROVED`. */
  state: string;
  body: string;
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
  /** The item whose step stopped it, when it was an item's. */
  readonly item: string | null;
  /** Items already visible to others when it stopped, by key, with
   *  their remote ids: posted, whatever happens to the rest. Empty
   *  where nothing is visible before the whole review is filed. */
  readonly posted: Record<string, string>;
  constructor(
    failure: PublishFailure,
    message: string,
    details: {
      cause?: unknown;
      item?: string | null;
      posted?: Record<string, string>;
    } = {}
  ) {
    super(
      message,
      details.cause === undefined ? undefined : { cause: details.cause }
    );
    this.name = 'ReviewPublishError';
    this.failure = failure;
    this.item = details.item ?? null;
    this.posted = details.posted ?? {};
  }
}

export function isReviewPublishError(err: unknown): err is ReviewPublishError {
  return err instanceof ReviewPublishError;
}

export function freshLedger(head: Oid): ReviewLedger {
  return {
    head,
    reviewId: null,
    inFlight: null,
    sending: null,
    added: {},
    submitted: false,
  };
}
