import { activeReviewService, repository } from './repo.js';

export async function listDrafts(repo: string, request: unknown) {
  return repository(repo).reviews.drafts.list(request);
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
