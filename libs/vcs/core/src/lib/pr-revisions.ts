import type { Oid, PullRequestRef } from './pr-details.js';

/**
 * A pull request's heads over time, as its provider records them.
 *
 * Providers record different things. GitHub lists the commits a pull
 * request gained and each time its branch was force-pushed; Azure DevOps
 * counts iterations, each a push with the target it was compared
 * against. Neither is turned into the other: a caller that offers "this
 * revision" can name what the provider said, and a history that is not
 * the whole of it says so.
 */
export type RevisionEvent =
  /** A commit in the branch's history as the provider lists it now. Not
   *  every one was a pushed head, and after a force-push the order is
   *  the commits', not the pushes'. */
  | { kind: 'commit'; head: Oid; at: string | null }
  /** The branch was rewritten. `before` is no longer in its history,
   *  and may be gone from the provider too; null when it would not say. */
  | { kind: 'force-push'; before: Oid | null; head: Oid; at: string | null }
  /** An Azure DevOps iteration: a push as the provider counted it, the
   *  target commit it was compared against and where the two met. The
   *  `reason` is the provider's word for it: `push`, `forcePush`… */
  | {
      kind: 'iteration';
      id: number;
      head: Oid;
      target: Oid | null;
      mergeBase: Oid | null;
      at: string | null;
      reason: string;
    };

export interface PullRequestRevisions {
  ref: PullRequestRef;
  /** In the provider's order, oldest first. */
  events: RevisionEvent[];
  /** False when the provider listed only the most recent events. */
  complete: boolean;
  /** The account the provider answered as, which `lastReview` is about;
   *  null when it would not say. */
  viewer: string | null;
  /** The head that account's latest submitted review was on, where the
   *  provider records one; `head` is null when the provider did not say
   *  which, and no older review stands in for it. A review still
   *  pending is not submitted, and a lone reply to a thread is not a
   *  review. */
  lastReview: { head: Oid | null; at: string | null } | null;
  /** False when the provider listed only the most recent reviews: a
   *  null `lastReview` then means "not among them", not "none". */
  reviewsComplete: boolean;
}
