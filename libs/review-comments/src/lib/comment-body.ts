import type { ReviewComment } from './types.js';
import {
  formatConventionalComment,
  resolveComment,
  withAgentFooter,
} from './conventional.js';

/**
 * The body a draft is posted with.
 *
 * The severity and the body's own header are settled against each
 * other first (see `resolveComment`), so what a reviewer reads and what
 * every severity-driven surface in n10 shows cannot disagree.
 *
 * The attribution goes at the end, not the front. A comment's opening
 * words are the ones a reviewer sees in a notification and in a
 * collapsed thread, and spending them on provenance buries the finding
 * behind a disclaimer. The claim is still made — where a signature
 * goes.
 */
export function renderCommentBody(comment: ReviewComment): string {
  const { header } = resolveComment(comment.body, comment.severity);
  return withAgentFooter(formatConventionalComment(header));
}
