import type { ReviewComment } from '@n10/review-comments';
import { readResourceValue, type PostAgentCommentsRequest } from '@n10/engine';
import { activeReviewService, repository } from './repo.js';

export async function listDraftComments(repo: string, prId: number) {
  return readResourceValue(
    repository(repo).reviews.agentComments.resource(prId)
  );
}
export function updateDraftComment(
  prId: number,
  id: string,
  patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>
) {
  activeReviewService().agentComments.update(prId, id, patch);
}
export function deleteDraftComment(prId: number, id: string) {
  activeReviewService().agentComments.remove(prId, id);
}
export async function postDraftComments(request: PostAgentCommentsRequest) {
  return activeReviewService().agentComments.post(request);
}
