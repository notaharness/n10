import { readResourceValue } from '@n10/engine';
import { repository } from './repo.js';

/** What the pull request's history offers to compare against. */
export function getPullRequestHistory(repo: string, request: unknown) {
  return readResourceValue(repository(repo).reviews.history(request));
}

/** Record the commits the reader was shown, and keep them in the clone. */
/** Local bookkeeping beside the history read, not a provider write:
 *  recorded for the repository the pane shows, open or parked. */
export function recordPullRequestVisit(repo: string, request: unknown) {
  return repository(repo).reviews.recordVisit(request);
}
