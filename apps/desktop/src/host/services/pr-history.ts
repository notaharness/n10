import { readResourceValue } from '@n10/engine';
import { activeReviewService, repository } from './repo.js';

/** What the pull request's history offers to compare against. */
export function getPullRequestHistory(repo: string, request: unknown) {
  return readResourceValue(repository(repo).reviews.history(request));
}

/** Record the commits the reader was shown, and keep them in the clone. */
export function recordPullRequestVisit(request: unknown) {
  return activeReviewService().recordVisit(request);
}
