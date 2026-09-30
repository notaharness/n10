import { logError } from '@n10/logger';
import { mkdirSync, watch } from 'node:fs';
import { agentCommentRepository } from '@n10/core';
import {
  readComments,
  updateComment,
  removeComment,
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
  function read(prId: number) {
    requirePullRequestNumber(prId);
    return readComments(repo(), prId).map((comment) =>
      comment.status === 'posting' && !publication.isPosting(prId)
        ? { ...comment, status: 'draft' as const }
        : comment
    );
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
          const watcher = watch(dir, () => current.invalidate());
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
  function existing(prId: number, id: string) {
    context.current();
    const comment = read(prId).find((item) => item.id === id);
    if (!comment) throw new Error('Draft comment no longer exists');
    publication.requireEditable(prId, comment);
    return comment;
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
      const comment = existing(prId, id);
      const body = patch.body ?? comment.body;
      const severity =
        patch.body === undefined
          ? patch.severity ?? comment.severity
          : resolveComment(body, patch.severity ?? comment.severity).severity;
      updateComment(repo(), prId, id, { body, severity });
      resources.get(prId)?.invalidate();
    },
    remove(prId: number, id: string) {
      existing(prId, id);
      removeComment(repo(), prId, id);
      resources.get(prId)?.invalidate();
    },
    dispose() {
      for (const watcher of watchers.values()) watcher.close();
      for (const value of resources.values()) value.dispose();
      watchers.clear();
      resources.clear();
    },
  };
}
