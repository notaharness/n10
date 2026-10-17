import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  listReviewDrafts,
  saveReviewDraft,
  submitReview,
  type DraftTarget,
} from '@n10/core';
import {
  isOid,
  sameRepository,
  REVIEW_EVENTS,
  type ReviewEvent,
} from '@n10/vcs-core';
import {
  readComments,
  updateComment,
  renderCommentBody,
  resolveComment,
  type ReviewComment,
} from '@n10/review-comments';
import {
  createReviewContext,
  requirePullRequestNumber,
  type ReviewContextOptions,
} from './review-context.js';

export interface PostAgentCommentsRequest {
  prId: number;
  ids?: string[];
  headSha?: string;
  event?: ReviewEvent;
}

function validatePostRequest(req: PostAgentCommentsRequest): void {
  if (req.event !== undefined && !REVIEW_EVENTS.includes(req.event))
    throw new TypeError('Invalid review event');
  if (
    req.ids !== undefined &&
    (!Array.isArray(req.ids) || !req.ids.every((id) => typeof id === 'string'))
  )
    throw new TypeError('Invalid draft ids');
}

/** Reuses core's durable submission ledger; VCS publishers own every network write. */
export function createAgentPublication(
  options: ReviewContextOptions,
  repository: () => string,
  changed: (prId: number) => void
) {
  const context = createReviewContext(options);
  const sources = {
    ...context.sources,
    dir: join(homedir(), '.n10', 'agent-review-publications'),
  };
  const pending = new Set<number>();
  function identity(prId: number) {
    requirePullRequestNumber(prId);
    const start = context.selected();
    if (!start.repository || !start.vcsConfigured)
      throw new Error('No review provider is configured');
    return {
      start,
      ref: { ...start.repository, number: prId },
      viewer: start.viewer,
    };
  }
  function draftState(prId: number, id: string) {
    const { ref, viewer } = identity(prId);
    return listReviewDrafts({ ref, viewer }, sources).drafts.find(
      (draft) => draft.id === `inline:agent-${id}`
    );
  }
  function requireEditable(prId: number, comment: ReviewComment) {
    if (pending.has(prId) || comment.status === 'posting')
      throw new Error('Comment is being posted');
    if (!comment.publication) {
      if (comment.status === 'posted')
        throw new Error('Comment is already posted');
      return;
    }
    assertPublicationScope(prId, comment);
    const state = draftState(prId, comment.id)?.publication.state;
    if (comment.status === 'posted' || state === 'published')
      throw new Error('Comment is already posted');
    if (state === 'unknown' || state === 'publishing')
      throw new Error(
        'This comment may already be posted. Retry posting it before editing'
      );
  }
  function assertPublicationScope(prId: number, comment: ReviewComment) {
    const { ref, viewer } = identity(prId);
    if (
      comment.publication &&
      (!sameRepository(ref, comment.publication) ||
        viewer !== comment.publication.viewer)
    ) {
      throw new Error(
        'Switch to the account and repository that started posting this comment'
      );
    }
  }
  function publicationContext(req: PostAgentCommentsRequest) {
    const captured = identity(req.prId);
    const publish = captured.start.provider?.publishReview?.bind(
      captured.start.provider
    );
    if (!publish)
      throw new Error("Reviews can't be posted from n10 for this repository");
    if (!isOid(req.headSha))
      throw new Error('Refresh pull requests and try again');
    return { ...captured, publish, head: req.headSha };
  }
  function prepareDraft(
    req: PostAgentCommentsRequest,
    comment: ReviewComment,
    captured: ReturnType<typeof publicationContext>
  ): string | null {
    const { ref, viewer, head } = captured;
    const target: DraftTarget = {
      kind: 'inline',
      key: `agent-${comment.id}`,
      anchor: {
        path: comment.file,
        previousPath: null,
        head,
        lines: [],
        range: {
          start: comment.lineStart,
          end: comment.lineEnd,
          startSide: comment.side,
          side: comment.side,
        },
      },
    };
    const existing = draftState(req.prId, comment.id);
    if (existing?.publication.state === 'published') return null;
    if (
      !existing ||
      existing.publication.state === 'unpublished' ||
      existing.publication.state === 'failed'
    ) {
      saveReviewDraft(
        { ref, viewer, target, body: renderCommentBody(comment) },
        sources
      );
    }
    return `inline:agent-${comment.id}`;
  }
  function recover(
    prId: number,
    comment: ReviewComment,
    captured: ReturnType<typeof identity>,
    repo: string
  ) {
    // A failed Azure publication may have posted this item. The ledger is authoritative.
    const state = listReviewDrafts(
      { ref: captured.ref, viewer: captured.viewer },
      {
        ...sources,
        repository: () => captured.ref,
        viewer: () => captured.viewer,
      }
    ).drafts.find((draft) => draft.id === `inline:agent-${comment.id}`)
      ?.publication.state;
    updateComment(repo, prId, comment.id, {
      status: state === 'published' ? 'posted' : 'draft',
      ...(state === 'unknown' || state === 'publishing'
        ? {}
        : { publication: undefined }),
    });
    return state === 'published';
  }
  async function post(req: PostAgentCommentsRequest) {
    identity(req.prId);
    validatePostRequest(req);
    if (pending.has(req.prId))
      throw new Error('These comments are already being posted');
    const repo = repository();
    const comments = readComments(repo, req.prId).filter(
      (comment) =>
        comment.status !== 'posted' &&
        (!req.ids || req.ids.includes(comment.id))
    );
    if (
      comments.some(
        (comment) =>
          !resolveComment(comment.body, comment.severity).header.subject
      )
    )
      throw new Error('Cannot post a comment with an empty body');
    if (!comments.length) return 0;
    const captured = publicationContext(req);
    for (const comment of comments) assertPublicationScope(req.prId, comment);
    pending.add(req.prId);
    const reconcile = () =>
      comments.reduce(
        (posted, comment) =>
          posted + Number(recover(req.prId, comment, captured, repo)),
        0
      );
    try {
      const draftIds = comments.flatMap((comment) => {
        const id = prepareDraft(req, comment, captured);
        return id ? [id] : [];
      });
      for (const comment of comments) {
        updateComment(repo, req.prId, comment.id, {
          status: 'posting',
          publication: { ...captured.ref, viewer: captured.viewer },
        });
      }
      changed(req.prId);
      if (draftIds.length) {
        await submitReview(
          {
            ref: captured.ref,
            viewer: captured.viewer,
            head: captured.head,
            event: req.event ?? 'COMMENT',
            draftIds,
          },
          {
            ...sources,
            publish: (submission, ledger) => {
              context.assertWritable(captured.start);
              return captured.publish(
                captured.start.config.vendorAuth,
                captured.start.config.vendorProject,
                submission,
                ledger
              );
            },
          }
        );
      }
      const posted = reconcile();
      if (posted !== comments.length)
        throw new Error(
          'The provider did not confirm all comments were posted'
        );
      return posted;
    } catch (error) {
      const posted = reconcile();
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Posted ${posted} of ${comments.length}, then failed: ${reason}`,
        { cause: error }
      );
    } finally {
      pending.delete(req.prId);
      changed(req.prId);
    }
  }
  return {
    post,
    requireEditable,
    isPosting: (prId: number) => pending.has(prId),
  };
}
