import { useMemo } from 'react';
import type { DiffFile, PrComparison, PrDiffManifestFile } from '@n10/core';
import type { PrDiffManifestRequest } from '@n10/engine/contract';
import { useEngine } from '../context/EngineContext.js';
import { useReadResource } from './useReadResource.js';

const NO_FILES: DiffFile[] = [];

const STATUS: Record<PrDiffManifestFile['status'], DiffFile['status']> = {
  added: 'added',
  deleted: 'removed',
  modified: 'modified',
  renamed: 'renamed',
  copied: 'copied',
  'type-changed': 'changed',
};

function listed(file: PrDiffManifestFile): DiffFile {
  return {
    filename: file.path,
    status: STATUS[file.status],
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    binary: file.kind === 'binary',
    ...(file.oldPath !== file.path ? { previousFilename: file.oldPath } : {}),
  };
}

/** The pull request's manifest at the provider's head, as the file list
 *  reads it; `request` is the comparison every file's patch is read at. */
export function useDiffData(
  prNumber: number | null,
  sourceBranch: string,
  targetBranch: string,
  headSha: string | undefined
) {
  const { reviews } = useEngine();
  const request = useMemo<PrDiffManifestRequest | null>(
    () =>
      prNumber && sourceBranch && targetBranch
        ? {
            repo: reviews.repo,
            sourceBranch,
            targetBranch,
            ...(headSha ? { expectedHeadOid: headSha } : {}),
          }
        : null,
    [reviews, prNumber, sourceBranch, targetBranch, headSha]
  );
  const resource = useMemo(
    () => (request ? reviews.diff.manifest(request) : null),
    [reviews, request]
  );
  const snapshot = useReadResource(resource);
  const result = snapshot.data;
  const files = useMemo(
    () => (result?.ok ? result.manifest.files.map(listed) : NO_FILES),
    [result]
  );
  return {
    request: result?.ok ? result.manifest.comparison : null,
    files,
    loading: snapshot.loading,
    error: result && !result.ok ? result.error.message : snapshot.error,
  };
}

/** One file's patch at the comparison, both paths of a rename named. */
export function useFileDiffData(
  request: PrComparison | null,
  file: Pick<DiffFile, 'filename' | 'previousFilename'> | null
) {
  const { reviews } = useEngine();
  const filename = file?.filename;
  const previous = file?.previousFilename;
  const resource = useMemo(
    () =>
      request && filename
        ? reviews.diff.patch({
            repo: reviews.repo,
            mergeBaseOid: request.mergeBaseOid,
            headOid: request.headOid,
            paths: previous ? [previous, filename] : [filename],
          })
        : null,
    [reviews, request, filename, previous]
  );
  const snapshot = useReadResource(resource);
  const result = snapshot.data;
  return {
    data: result?.ok ? result.patch.text : null,
    loading: snapshot.loading,
    error: result && !result.ok ? result.error.message : snapshot.error,
  };
}
