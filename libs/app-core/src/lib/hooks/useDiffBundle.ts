import { useCallback } from 'react';
import { useDiffData } from './useDiffData.js';
import { useReviewComments } from './useReviewComments.js';
import { useRemoteComments } from './useRemoteComments.js';
import { useSessionActions } from '../context/SessionContext.js';

// The selected PR’s resources and presentation callbacks, shared by its panes.
export function useDiffBundle(
  prNumber: number | null,
  sourceBranch: string,
  targetBranch: string,
  headSha: string | undefined
) {
  const diff = useDiffData(prNumber, sourceBranch, targetBranch, headSha);
  const comments = useReviewComments(prNumber);
  const { flashStatus } = useSessionActions();
  const onFetchError = useCallback(
    (msg: string) => flashStatus(`Failed to load comments: ${msg}`),
    [flashStatus]
  );
  const remote = useRemoteComments(prNumber, onFetchError);
  return { ...diff, comments, remote };
}

export type DiffBundle = ReturnType<typeof useDiffBundle>;
