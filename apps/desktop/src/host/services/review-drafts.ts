import { activeReviewService } from './repo.js';

export async function listDrafts(request: unknown) {
  return activeReviewService().drafts.list(request);
}
export async function saveDraft(request: unknown) {
  return activeReviewService().drafts.save(request);
}
export async function discardDraft(request: unknown) {
  return activeReviewService().drafts.discard(request);
}
export async function submitReview(request: unknown) {
  return activeReviewService().drafts.submit(request);
}
