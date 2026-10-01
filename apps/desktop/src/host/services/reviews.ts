import type { ReviewVerdict } from '@n10/vcs-core';
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
export async function submitReviewVerdict(
  prId: number,
  verdict: ReviewVerdict
) {
  await activeReviewService().commands.verdict(prId, verdict);
}
export function getDiffText(sourceBranch: string, targetBranch: string) {
  return readResourceValue(
    activeReviewService().diff.full({ sourceBranch, targetBranch })
  );
}
