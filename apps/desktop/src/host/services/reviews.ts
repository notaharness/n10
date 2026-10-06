import { readResourceValue } from '@n10/engine';
import { activeReviewService } from './repo.js';
import type { ReplyRequest, ResolveRequest } from '../contract.js';

export function getReviewViewer() {
  return activeReviewService().commands.viewer();
}
export async function fetchCommentThreads(prId: number, force = false) {
  return readResourceValue(activeReviewService().comments(prId), force);
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
export async function fetchPrDescription(prId: number) {
  return readResourceValue(activeReviewService().description(prId));
}
/** A pull request's comparison and file manifest at exact commits. */
export function getPrDiffManifest(req: unknown) {
  return readResourceValue(activeReviewService().diff.manifest(req));
}
/** The patch between a resolved comparison's commits. */
export function getPrDiffPatch(req: unknown) {
  return readResourceValue(activeReviewService().diff.patch(req));
}
/** One side of a changed image, by blob id. */
export function getPrDiffImage(req: unknown) {
  return readResourceValue(activeReviewService().diff.image(req));
}
/** Two revisions resolved to exact commits, and every file changed
 *  between them. */
export function getPrRangeManifest(req: unknown) {
  return readResourceValue(activeReviewService().diff.rangeManifest(req));
}
