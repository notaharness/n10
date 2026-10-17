import type { DraftTarget } from '@n10/core';
import type { Oid } from '@n10/vcs-core';
import {
  renderCommentBody,
  renderSummaryBody,
  type ReviewComment,
} from '@n10/review-comments';

/**
 * The draft an agent finding is published as. A finding on lines or on
 * a whole file is an inline draft of its own; findings on the pull
 * request itself share the review's summary, which a review has one of.
 */
export function agentDraftId(comment: ReviewComment): string {
  return comment.file === null ? 'summary' : `inline:agent-${comment.id}`;
}

export interface AgentDraft {
  id: string;
  target: DraftTarget;
  body: string;
}

function inlineDraft(comment: ReviewComment & { file: string }, head: Oid) {
  const range =
    comment.lineStart === null || comment.lineEnd === null
      ? null
      : {
          start: comment.lineStart,
          end: comment.lineEnd,
          startSide: comment.side,
          side: comment.side,
        };
  return {
    id: agentDraftId(comment),
    target: {
      kind: 'inline' as const,
      key: `agent-${comment.id}`,
      anchor: {
        path: comment.file,
        previousPath: null,
        head,
        lines: [],
        range,
      },
    },
    body: renderCommentBody(comment),
  };
}

/** The drafts `comments` are filed as at `head`, in the order written. */
export function agentDrafts(
  comments: ReviewComment[],
  head: Oid
): AgentDraft[] {
  const drafts: AgentDraft[] = [];
  const onPullRequest: ReviewComment[] = [];
  for (const comment of comments) {
    if (comment.file === null) onPullRequest.push(comment);
    else drafts.push(inlineDraft({ ...comment, file: comment.file }, head));
  }
  if (onPullRequest.length) {
    drafts.push({
      id: 'summary',
      target: { kind: 'summary' },
      body: renderSummaryBody(onPullRequest),
    });
  }
  return drafts;
}
