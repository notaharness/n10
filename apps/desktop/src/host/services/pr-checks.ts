import { readResourceValue } from '@n10/engine';
import { activeReviewService } from './repo.js';

export async function getPullRequestChecks(request: unknown) {
  return readResourceValue(activeReviewService().checks(request));
}
