import { readResourceValue } from '@n10/engine';
import { activeReviewService, repository } from './repo.js';
import type { ReplyRequest, ResolveRequest } from '../contract.js';

export function getReviewViewer(repo: string) {
  return repository(repo).reviews.commands.viewer();
}
export async function fetchCommentThreads(
  repo: string,
  prId: number,
  force = false
) {
  return readResourceValue(repository(repo).reviews.comments(prId), force);
}
export async function replyToThread(req: ReplyRequest): Promise<void> {
  await activeReviewService().commands.reply({
    prId: req.prId,
    threadId: req.thread.id,
    body: req.body,
  });
}
export async function setThreadResolved(req: ResolveRequest): Promise<void> {
  await activeReviewService().commands.resolve({
    prId: req.prId,
    threadId: req.thread.id,
    resolved: req.resolved,
  });
}
export async function fetchPrDescription(repo: string, prId: number) {
  return readResourceValue(repository(repo).reviews.description(prId));
}
/** A pull request's comparison and file manifest at exact commits. */
export function getPrDiffManifest(req: unknown) {
  return readResourceValue(activeReviewService().diff.manifest(req));
}
/** The patch between a resolved comparison's commits. */
export function getPrDiffPatch(req: unknown) {
  return readResourceValue(activeReviewService().diff.patch(req));
}
/** Two revisions resolved to exact commits, and every file changed
 *  between them. */
export function getPrRangeManifest(req: unknown) {
  return readResourceValue(activeReviewService().diff.rangeManifest(req));
}
