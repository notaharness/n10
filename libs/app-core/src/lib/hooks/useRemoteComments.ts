import { useMemo, useCallback, useEffect, useEffectEvent } from 'react';
import type { PullRequestComments } from '@n10/vcs-core';
import { useEngine } from '../context/EngineContext.js';
import { useReadResource } from './useReadResource.js';

const EMPTY_COMMENTS: PullRequestComments = {
  threads: [],
  generalComments: [],
};

/** Observes review resources; all provider commands and invalidation are engine-owned. */
export function useRemoteComments(
  prId: number | null,
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
    async (threadId: string, body: string) => {
      if (!prId) throw new Error("Can't reply on this pull request");
      return reviews.commands.reply({ prId, threadId, body });
    },
    [prId, reviews]
  );
  const toggleResolved = useCallback(
    async (threadId: string, resolved: boolean) => {
      if (!prId) return false;
      return reviews.commands.resolve({ prId, threadId, resolved });
    },
    [prId, reviews]
  );
  return {
    ...comments,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh,
    replyToThread,
    toggleResolved,
  };
}
