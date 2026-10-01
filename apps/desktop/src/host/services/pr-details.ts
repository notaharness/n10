import { readResourceValue } from '@n10/engine';
import { activeReviewService } from './repo.js';

export async function getPullRequestSnapshot(request: unknown) {
  return readResourceValue(activeReviewService().snapshot(request));
}
