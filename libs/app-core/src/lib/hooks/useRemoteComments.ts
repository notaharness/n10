import { useMemo, useCallback, useEffect, useEffectEvent } from 'react';
import type {
  PullRequestComments,
  RemoteCommentThread,
  RemoteCommentReply,
  VcsProvider,
} from '@n10/vcs-core';
import { useEngine } from '../context/EngineContext.js';
import { useReadResource } from './useReadResource.js';

const EMPTY_COMMENTS: PullRequestComments = {
  threads: [],
  generalComments: [],
};

export function useRemoteComments(
  prId: number | null,
  provider: VcsProvider | null,
  auth: Record<string, string>,
  project: Record<string, string>,
  onResolvedChange?: () => void,
  onFetchError?: (message: string) => void
) {
  const { reviews } = useEngine();
  const resource = useMemo(
    () => (prId ? reviews.comments(prId) : null),
    [reviews, prId]
  );
  const snapshot = useReadResource(resource);
  const comments = snapshot.data ?? EMPTY_COMMENTS;
  const reportError = useEffectEvent(() => {
    if (snapshot.error) onFetchError?.(snapshot.error);
  });
  useEffect(() => reportError(), [snapshot.error]);
  const refresh = useCallback(() => {
    if (resource) void resource.read(true);
  }, [resource]);

  const replyToThread = useCallback(
    async (threadId: string, body: string): Promise<RemoteCommentReply> => {
      if (!prId || !provider?.replyToThread || !resource)
        throw new Error("Can't reply on this pull request");
      const thread = [...comments.threads, ...comments.generalComments].find(
        (item) => item.id === threadId
      );
      if (!thread)
        throw new Error(`Reply failed: thread ${threadId} not found`);
      const reply = await provider.replyToThread(
        auth,
        project,
        prId,
        thread,
        body
      );
      const append = (threads: RemoteCommentThread[]) =>
        threads.map((item) =>
          item.id === threadId
            ? { ...item, comments: [...item.comments, reply] }
            : item
        );
      if (
        !resource.patch(snapshot, (data) => ({
          threads: append(data.threads),
          generalComments: append(data.generalComments),
        }))
      )
        resource.invalidate();
      return reply;
    },
    [prId, provider, auth, project, resource, comments, snapshot]
  );

  const toggleResolved = useCallback(
    async (threadId: string, resolved: boolean): Promise<boolean> => {
      if (!prId || !provider?.setThreadResolved || !resource) return false;
      const thread = [...comments.threads, ...comments.generalComments].find(
        (item) => item.id === threadId
      );
      if (!thread?.canResolve) return false;
      await provider.setThreadResolved(auth, project, prId, thread, resolved);
      const update = (threads: RemoteCommentThread[]) =>
        threads.map((item) =>
          item.id === threadId ? { ...item, isResolved: resolved } : item
        );
      if (
        !resource.patch(snapshot, (data) => ({
          threads: update(data.threads),
          generalComments: update(data.generalComments),
        }))
      )
        resource.invalidate();
      onResolvedChange?.();
      return true;
    },
    [
      prId,
      provider,
      auth,
      project,
      resource,
      comments,
      snapshot,
      onResolvedChange,
    ]
  );

  return {
    threads: comments.threads,
    generalComments: comments.generalComments,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh,
    replyToThread,
    toggleResolved,
  };
}
