import { useCallback, useMemo } from 'react';
import { draftRepoKey, type DraftScope } from '@n10/review-comments';
import { useDiffData } from './useDiffData.js';
import { useReviewComments } from './useReviewComments.js';
import { useRemoteComments } from './useRemoteComments.js';
import { useConfig } from '../context/ConfigContext.js';
import { useSessionActions } from '../context/SessionContext.js';

// Single source of truth for PR diff data. Mounted once in MainContent
// and threaded to both DiffFileListContainer and DiffFileViewerContainer
// so they share the same `files`, per-file diff cache, and `fs.watch`-
// backed comment stream. Without this, each container mounted its own
// useDiffData + useReviewComments — the list and viewer would each
// re-fetch, and switching between them would clear in-memory caches.
export function useDiffBundle(
  prNumber: number | null,
  sourceBranch: string,
  targetBranch: string,
  headSha: string | undefined
) {
  const diff = useDiffData(prNumber, sourceBranch, targetBranch, headSha);
  const { provider, config } = useConfig();
  // This repository's drafts for the PR: another repository's #7 is a
  // different pull request.
  const repo = draftRepoKey(config.vendor, config.vendorProject);
  const draftScope = useMemo<DraftScope | null>(
    () =>
      repo !== null && prNumber !== null ? { repo, prId: prNumber } : null,
    [repo, prNumber]
  );
  const comments = useReviewComments(draftScope);
  const { refreshPr, flashStatus } = useSessionActions();
  const onFetchError = useCallback(
    (msg: string) => flashStatus(`Failed to load comments: ${msg}`),
    [flashStatus]
  );
  // A resolve/unresolve should refresh the pull request, but the
  // callback is declared void-returning and nothing awaits it: a failed
  // refresh leaves the row stale until the next poll, which is why the
  // rejection is discarded rather than surfaced.
  const onResolvedChange = useCallback(() => void refreshPr(), [refreshPr]);
  const remote = useRemoteComments(
    prNumber,
    provider,
    config.vendorAuth,
    config.vendorProject,
    onResolvedChange,
    onFetchError
  );
  return { ...diff, comments, draftScope, remote };
}

export type DiffBundle = ReturnType<typeof useDiffBundle>;
