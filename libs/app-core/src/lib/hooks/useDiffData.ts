import { useMemo } from 'react';
import type { DiffFile } from '@n10/core';
import type { DiffRequest, DiffRefs } from '@n10/engine/contract';
import { useEngine } from '../context/EngineContext.js';
import { useReadResource } from './useReadResource.js';

const NO_FILES: DiffFile[] = [];

export function useDiffData(
  prNumber: number | null,
  sourceBranch: string,
  targetBranch: string,
  headSha: string | undefined
) {
  const { reviews } = useEngine();
  const request = useMemo<DiffRequest | null>(
    () =>
      prNumber && sourceBranch && targetBranch
        ? { sourceBranch, targetBranch, headSha }
        : null,
    [prNumber, sourceBranch, targetBranch, headSha]
  );
  const resource = useMemo(
    () => (request ? reviews.diff.files(request) : null),
    [reviews, request]
  );
  const snapshot = useReadResource(resource);
  return {
    request: snapshot.data,
    files: snapshot.data?.files ?? NO_FILES,
    loading: snapshot.loading,
    error: snapshot.error,
  };
}

export function useFileDiffData(
  request: DiffRefs | null,
  filename: string | null
) {
  const { reviews } = useEngine();
  const resource = useMemo(
    () => (request && filename ? reviews.diff.file(request, filename) : null),
    [reviews, request, filename]
  );
  return useReadResource(resource);
}
