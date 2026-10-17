import { logError } from '@n10/logger';
import { mkdirSync, watch } from 'node:fs';
import { agentCommentRepository, changeAgentComments } from '@n10/core';
import {
  readComments,
  commentDirPath,
  resolveComment,
  type ReviewComment,
} from '@n10/review-comments';
import { createReadResource } from './read-resource.js';
import { createAgentPublication } from './agent-publication.js';
import {
  createReviewContext,
  requirePullRequestNumber,
  type ReviewContextOptions,
} from './review-context.js';

/** The findings, and the claim a post in any process holds. */
const WATCHED = new Set(['comments.json', 'posting.lock']);

/** One repo owns agent findings, filesystem observation and publication policy. */
export function createAgentComments(
  options: ReviewContextOptions,
  invalidate: () => void
) {
  const context = createReviewContext(options);
  let repository: string | undefined;
  const repo = () =>
    (repository ??= agentCommentRepository(options.config.repo));
  const resources = new Map<
    number,
    ReturnType<typeof createReadResource<ReviewComment[]>>
  >();
  const watchers = new Map<number, ReturnType<typeof watch>>();
  const publication = createAgentPublication(options, repo, (prId) => {
    resources.get(prId)?.invalidate();
    invalidate();
  });
  /** `posting` with no post running means the post that marked it stopped. */
  function asRead(prId: number, comment: ReviewComment): ReviewComment {
    return comment.status === 'posting' && !publication.isPosting(prId)
      ? { ...comment, status: 'draft' as const }
      : comment;
  }
  function read(prId: number) {
    requirePullRequestNumber(prId);
    return readComments(repo(), prId).map((comment) => asRead(prId, comment));
  }
  function resource(prId: number) {
    requirePullRequestNumber(prId);
    let value = resources.get(prId);
    if (value) return value;
    const current = createReadResource(async () => read(prId), 250);
    value = {
      ...current,
      subscribe(listener: () => void) {
        const unsubscribe = current.subscribe(listener);
        if (!watchers.has(prId)) {
          const dir = commentDirPath(repo(), prId);
          mkdirSync(dir, { recursive: true });
          // Lock and temporary files come and go on every write.
          const watcher = watch(dir, (_event, name) => {
            if (!name || WATCHED.has(name)) current.invalidate();
          });
          watcher.on('error', (error) => {
            logError('agent comments watch', error);
            watcher.close();
            watchers.delete(prId);
            current.invalidate();
          });
          watcher.unref();
          watchers.set(prId, watcher);
        }
        return () => {
          unsubscribe();
          if (!current.observed()) {
            watchers.get(prId)?.close();
            watchers.delete(prId);
          }
        };
      },
    };
    resources.set(prId, value);
    return value;
  }
  /** Checked and changed under the store lock, so a post another
   *  process starts cannot slip between the check and the write. */
  function edit(
    prId: number,
    id: string,
    change: (comment: ReviewComment) => ReviewComment | null
  ) {
    context.selected();
    requirePullRequestNumber(prId);
    changeAgentComments(repo(), prId, (comments) => {
      const stored = comments.find((item) => item.id === id);
      if (!stored) throw new Error('Draft comment no longer exists');
      publication.requireEditable(prId, asRead(prId, stored));
      return comments.flatMap((item) => {
        if (item !== stored) return [item];
        const changed = change(item);
        return changed ? [changed] : [];
      });
    });
    resources.get(prId)?.invalidate();
  }
  return {
    read,
    resource,
    post: publication.post,
    update(
      prId: number,
      id: string,
      patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>
    ) {
      edit(prId, id, (comment) => {
        const body = patch.body ?? comment.body;
        const severity =
          patch.body === undefined
            ? patch.severity ?? comment.severity
            : resolveComment(body, patch.severity ?? comment.severity).severity;
        return { ...comment, body, severity };
      });
    },
    remove(prId: number, id: string) {
      edit(prId, id, () => null);
    },
  };
}
