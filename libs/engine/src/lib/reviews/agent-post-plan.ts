import { REVIEW_EVENTS, type ReviewEvent } from '@n10/vcs-core';
import { resolveComment, type ReviewComment } from '@n10/review-comments';

export interface PostAgentCommentsRequest {
  prId: number;
  ids?: string[];
  headSha?: string;
  event?: ReviewEvent;
}

export function validatePostRequest(req: PostAgentCommentsRequest): void {
  if (req.event !== undefined && !REVIEW_EVENTS.includes(req.event))
    throw new TypeError('Invalid review event');
  if (
    req.ids !== undefined &&
    (!Array.isArray(req.ids) || !req.ids.every((id) => typeof id === 'string'))
  )
    throw new TypeError('Invalid draft ids');
}

export function postable(
  comments: ReviewComment[],
  req: PostAgentCommentsRequest
): ReviewComment[] {
  const chosen = comments.filter(
    (comment) =>
      comment.status !== 'posted' && (!req.ids || req.ids.includes(comment.id))
  );
  if (
    chosen.some(
      (comment) =>
        !resolveComment(comment.body, comment.severity).header.subject
    )
  )
    throw new Error('Cannot post a comment with an empty body');
  return chosen;
}

/**
 * Refuses findings on code written on another commit than `head`: their
 * lines belong to that commit, and at `head` they may be outside the
 * diff or on other code. A finding on the pull request has no lines.
 */
export function assertWrittenAt(comments: ReviewComment[], head: string) {
  const stale = comments.filter(
    (comment) =>
      comment.file !== null &&
      comment.head !== undefined &&
      comment.head !== head
  );
  if (!stale.length) return;
  const one = stale.length === 1;
  throw new Error(
    `${one ? 'This comment was' : `${stale.length} comments were`} drafted ` +
      'against a different commit than the pull request’s current head ' +
      `(${head.slice(0, 7)}). Discard ${
        one ? 'it' : 'them'
      } or rerun the review.`
  );
}

/**
 * What a post does with the findings on the pull request, which share
 * the review's summary. One carrying a publication went out in the
 * summary last sent. While that summary's outcome is unknown, only
 * those go, and the summary is sent again as it was: a new finding
 * waits for the next post. Once the summary is published, they are
 * posted, and a new summary carries the rest.
 */
function summaryPlan(
  comments: ReviewComment[],
  summary: string | undefined
): { waiting: Set<string>; posted: Set<string> } {
  const onPullRequest = comments.filter((comment) => comment.file === null);
  const ids = (sent: boolean) =>
    new Set(
      onPullRequest
        .filter((comment) => Boolean(comment.publication) === sent)
        .map((comment) => comment.id)
    );
  if (summary === 'unknown' || summary === 'publishing')
    return { waiting: ids(false), posted: new Set() };
  if (summary === 'published') return { waiting: new Set(), posted: ids(true) };
  return { waiting: new Set(), posted: new Set() };
}

export interface PostPlan {
  /** The findings as stored once the post starts. */
  next: ReviewComment[];
  /** The findings this post sends, marked `posting`. */
  sending: ReviewComment[];
  /** How many were found posted already, in a published summary. */
  settled: number;
  /** How many wait for the summary sent before to be answered. */
  waiting: number;
}

/** The findings `req` chooses, marked for a post bound to `publication`;
 *  `summary` is where the review's summary stands. */
export function planPost(
  stored: ReviewComment[],
  req: PostAgentCommentsRequest,
  publication: NonNullable<ReviewComment['publication']>,
  summary: string | undefined
): PostPlan {
  const chosen = postable(stored, req);
  const { waiting, posted } = summaryPlan(chosen, summary);
  const ids = new Set(
    chosen
      .map((comment) => comment.id)
      .filter((id) => !waiting.has(id) && !posted.has(id))
  );
  const next = stored.map((comment) => {
    if (ids.has(comment.id))
      return { ...comment, status: 'posting' as const, publication };
    if (posted.has(comment.id))
      return { ...comment, status: 'posted' as const, publication: undefined };
    return comment;
  });
  return {
    next,
    sending: next.filter((comment) => ids.has(comment.id)),
    settled: posted.size,
    waiting: waiting.size,
  };
}
