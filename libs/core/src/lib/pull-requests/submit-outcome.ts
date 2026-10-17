import {
  isReviewPublishError,
  type LedgerStore,
  type PublishedReview,
} from '@n10/vcs-core';
import type { Publication, ReviewDraft } from './review-draft-types.js';

/**
 * Where each draft of a submit stands once the provider has answered:
 * filed, refused, posted before a failure, or not yet known.
 */

/**
 * Items already in front of others are settled as posted, and their
 * drafts spent; the ledger forgets them, so a new draft for the same
 * place (same id) is a new comment, not one already sent.
 */
export function forgetPosted(ledger: LedgerStore, err: unknown): void {
  const l = ledger.read();
  if (!l || !isReviewPublishError(err)) return;
  const posted = Object.keys(err.posted);
  if (!posted.length) return;
  ledger.write({
    ...l,
    added: Object.fromEntries(
      Object.entries(l.added).filter(([k]) => !posted.includes(k))
    ),
  });
}

export /** Marked by this attempt (being posted, or held back maybe posted),
 *  and not settled since. */
function ownedBy(d: ReviewDraft, attempt: string): boolean {
  const p = d.publication;
  return (
    (p.state === 'publishing' || p.state === 'unknown') && p.attempt === attempt
  );
}

/**
 * The summary text the filed review carries, as n10's: what this
 * submit sent, or — for a review already filed — the review's own text
 * when it is the summary draft's, whoever filed it.
 */
export function summarySent(
  chosen: ReviewDraft[],
  published: PublishedReview
): (d: ReviewDraft) => boolean {
  if (!published.resumed) {
    const sent = chosen.some((d) => d.target.kind === 'summary');
    return () => sent;
  }
  const { body } = published.resumed;
  return (d) => body.trim() !== '' && d.body === body;
}

/**
 * Where a draft stands once the review is filed: posted when the
 * review holds it (an item by its comment, the summary as the review's
 * own text when it went with the submit), or back to unpublished when
 * this attempt chose it and the review filed does not hold it.
 */
export function settled(
  d: ReviewDraft,
  published: PublishedReview,
  summary: (d: ReviewDraft) => boolean,
  attempt: string,
  at: number
): ReviewDraft {
  const remoteId =
    published.items[d.id] ??
    (d.target.kind === 'summary' && summary(d) ? published.reviewId : null);
  if (remoteId) {
    return { ...d, publication: { state: 'published', attempt, remoteId, at } };
  }
  return ownedBy(d, attempt)
    ? { ...d, publication: { state: 'unpublished' } }
    : d;
}

/**
 * Where a draft stands after a failed attempt. Posted (Azure DevOps
 * shows each comment as it goes): published. Unanswered: it may be in
 * the review, so it is looked for next time. Refused at an item: that
 * draft carries the provider's reason and can be edited; the others
 * were not refused and are as they were. Refused at the review itself:
 * every draft carries the reason. Stopped before any write (the pull
 * request moved on, a pending review of the reviewer's own): as it was.
 */
export function afterFailure(
  d: ReviewDraft,
  err: unknown,
  unanswered: boolean,
  at: number
): Publication {
  const { attempt } = d.publication as { attempt: string };
  const reason = err instanceof Error ? err.message : String(err);
  // Already in front of others, whatever became of the rest.
  const posted = isReviewPublishError(err) ? err.posted[d.id] : undefined;
  if (posted) return { state: 'published', attempt, remoteId: posted, at };
  // A step of this or an earlier attempt is still unaccounted for.
  if (unanswered) return { state: 'unknown', attempt, since: at };
  if (!isReviewPublishError(err)) {
    // The read before any write failed: nothing was sent.
    return { state: 'failed', attempt, reason, at };
  }
  if (err.failure !== 'refused') return { state: 'unpublished' };
  if (err.item && err.item !== d.id) return { state: 'unpublished' };
  return { state: 'failed', attempt, reason, at };
}
