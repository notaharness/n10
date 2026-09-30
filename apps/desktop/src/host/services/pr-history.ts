import { readResourceValue } from '@n10/engine';
import { activeReviewService } from './repo.js';

/** What the pull request's history offers to compare against. */
export function getPullRequestHistory(request: unknown) {
  return readResourceValue(activeReviewService().history(request));
}

/** Record the commits the reader was shown, and keep them in the clone. */
export function recordPullRequestVisit(request: unknown) {
  return activeReviewService().recordVisit(request);
}

/** Two revisions of the open repository, resolved to exact commits. */
export function resolvePrRevisionRange(request: unknown) {
  return readResourceValue(activeReviewService().diff.range(request));
}
