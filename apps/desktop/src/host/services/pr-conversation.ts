import { readResourceValue } from '@n10/engine';
import { activeReviewService } from './repo.js';

export async function getPullRequestConversation(request: unknown) {
  return readResourceValue(activeReviewService().conversation(request));
}
