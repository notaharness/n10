import { activeReviewService } from './repo.js';

export async function searchMentionCandidates(request: unknown) {
  return activeReviewService().drafts.mentions(request);
}
