import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  PullRequestComments,
  RemoteCommentThread,
  RemoteCommentReply,
  VcsProvider,
} from '@n10/vcs-core';
import { logError } from '@n10/logger';

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
  const [comments, setComments] = useState<PullRequestComments>(EMPTY_COMMENTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the cache and the liveness token are keyed by: the PR number
  // *in* a repository, reached through a provider with a set of
  // credentials. The number alone names another pull request once the
  // project settings change. Compared by content, so a settings save
  // that leaves these alone keeps the cache.
  const requestKey = JSON.stringify([provider?.id, auth, project, prId]);
  const activeKeyRef = useRef<string | null>(null);
  const cacheRef = useRef<Map<string, PullRequestComments>>(new Map());
  // Stabilize onFetchError across renders so it doesn't cycle
  // fetchComments' deps (which would re-fire the effect on every render).
  const onFetchErrorRef = useRef(onFetchError);
  onFetchErrorRef.current = onFetchError;

  const fetchComments = useCallback(
    async (forceRefresh = false) => {
      if (!prId || !provider?.fetchCommentThreads) {
        setComments(EMPTY_COMMENTS);
        return;
      }

      // Use cache unless force-refreshing
      if (!forceRefresh) {
        const cached = cacheRef.current.get(requestKey);
        if (cached) {
          setComments(cached);
          return;
        }
      }

      // Logged always, shown only if this response still belongs to
      // the PR on screen — see the note on activeKeyRef below.
      const reportFailure = (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`fetchCommentThreads [${provider.id}]`, err as Error);
        if (activeKeyRef.current === requestKey) {
          setError(msg);
          onFetchErrorRef.current?.(msg);
        }
      };

      setLoading(true);
      setError(null);
      try {
        const result = await provider.fetchCommentThreads(auth, project, prId);
        // Cache unconditionally — it's keyed by the closured request so
        // it's correct even if the user has moved on. Only commit to
        // visible state if this response still matches the active one.
        cacheRef.current.set(requestKey, result);
        if (activeKeyRef.current === requestKey) {
          setComments(result);
        }
      } catch (err: unknown) {
        reportFailure(err);
      } finally {
        if (activeKeyRef.current === requestKey) {
          setLoading(false);
        }
      }
    },
    [prId, provider, auth, project, requestKey]
  );

  // Fetch when the request changes. `activeKeyRef` is the single liveness
  // token an in-flight fetch checks before it commits: while mounted it
  // holds the selected request (so a response for a PR or repository the
  // user has moved off is dropped),
  // and clearing it on teardown means a response arriving after this hook is
  // gone is dropped too — it can never flash a fetch error at the user for a
  // view that no longer exists. A dep change runs the cleanup and the body in
  // the same synchronous commit, so nothing in flight can observe the gap.
  useEffect(() => {
    activeKeyRef.current = requestKey;
    void fetchComments();
    return () => {
      activeKeyRef.current = null;
    };
  }, [fetchComments, requestKey]);

  const refresh = useCallback(() => {
    void fetchComments(true);
  }, [fetchComments]);

  const replyToThread = useCallback(
    async (threadId: string, body: string): Promise<RemoteCommentReply> => {
      if (!prId || !provider?.replyToThread) {
        throw new Error('Reply not available — no provider or PR');
      }
      // Look up the thread by id — providers branch on its `replyKind`
      // to pick the right mutation (GitHub review-thread vs issue-comment).
      const all = [...comments.threads, ...comments.generalComments];
      const thread = all.find((t) => t.id === threadId);
      if (!thread) {
        throw new Error(`Reply failed: thread ${threadId} not found`);
      }
      try {
        const reply = await provider.replyToThread(
          auth,
          project,
          prId,
          thread,
          body
        );
        // Optimistically update the local state
        const updateThreads = (
          threads: RemoteCommentThread[]
        ): RemoteCommentThread[] =>
          threads.map((t) =>
            t.id === threadId ? { ...t, comments: [...t.comments, reply] } : t
          );
        setComments((prev) => ({
          threads: updateThreads(prev.threads),
          generalComments: updateThreads(prev.generalComments),
        }));
        // Also update cache
        const cached = cacheRef.current.get(requestKey);
        if (cached) {
          cacheRef.current.set(requestKey, {
            threads: updateThreads(cached.threads),
            generalComments: updateThreads(cached.generalComments),
          });
        }
        return reply;
      } catch (err: unknown) {
        logError(`replyToThread [${provider.id}]`, err as Error);
        throw err;
      }
    },
    [prId, provider, auth, project, comments, requestKey]
  );

  const toggleResolved = useCallback(
    async (threadId: string, resolved: boolean): Promise<boolean> => {
      if (!prId || !provider?.setThreadResolved) return false;
      const all = [...comments.threads, ...comments.generalComments];
      const thread = all.find((t) => t.id === threadId);
      if (!thread) return false;
      if (!thread.canResolve) return false;
      try {
        await provider.setThreadResolved(auth, project, prId, thread, resolved);
        // Optimistically update the local state
        const updateThreads = (
          threads: RemoteCommentThread[]
        ): RemoteCommentThread[] =>
          threads.map((t) =>
            t.id === threadId ? { ...t, isResolved: resolved } : t
          );
        setComments((prev) => ({
          threads: updateThreads(prev.threads),
          generalComments: updateThreads(prev.generalComments),
        }));
        const cached = cacheRef.current.get(requestKey);
        if (cached) {
          cacheRef.current.set(requestKey, {
            threads: updateThreads(cached.threads),
            generalComments: updateThreads(cached.generalComments),
          });
        }
        // Notify caller so PR-level state (e.g. activeCommentCount on the
        // sidebar badge) can be refreshed without waiting for the next
        // PR poll tick.
        onResolvedChange?.();
        return true;
      } catch (err: unknown) {
        logError(`setThreadResolved [${provider.id}]`, err as Error);
        throw err;
      }
    },
    [prId, provider, auth, project, onResolvedChange, comments, requestKey]
  );

  return {
    threads: comments.threads,
    generalComments: comments.generalComments,
    loading,
    error,
    refresh,
    replyToThread,
    toggleResolved,
  };
}
