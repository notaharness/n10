import { queryOptions } from '@tanstack/react-query';
import type { PullRequestInfo } from '@n10/vcs-core';
import type {
  PrComparison,
  PrDiffError,
  PrDiffManifest,
} from '../../../host/contract.js';
import { keys } from '../data/query-keys.js';
import { measured } from '../perf.js';
import type { PinnedRevision } from './pinned-revisions.js';

/**
 * The two reads behind a pull request's diff, as query options both the
 * pane and a prefetch (Load new commits, Retry) use, so either one fills
 * the cache the other reads.
 */

/** A failure that describes the pull request rather than the transport. */
export class PrDiffLoadError extends Error {
  readonly code: PrDiffError['code'];
  constructor(error: PrDiffError) {
    super(error.message);
    this.code = error.code;
  }
}

export type PrBranches = Pick<
  PullRequestInfo,
  'id' | 'sourceBranch' | 'targetBranch' | 'headSha'
>;

async function loadManifest(
  repo: string,
  source: string,
  pin: PinnedRevision
): Promise<PrDiffManifest> {
  const result = await window.n10.fetchPrDiffManifest({
    repo,
    sourceBranch: source,
    targetBranch: pin.target,
    ...(pin.head ? { expectedHeadOid: pin.head } : {}),
    ...(pin.targetOid ? { expectedTargetOid: pin.targetOid } : {}),
  });
  if (!result.ok) throw new PrDiffLoadError(result.error);
  return result.manifest;
}

async function loadPatch(repo: string, comparison: PrComparison) {
  const result = await window.n10.fetchPrDiffPatch({
    repo,
    mergeBaseOid: comparison.mergeBaseOid,
    headOid: comparison.headOid,
  });
  if (!result.ok) throw new PrDiffLoadError(result.error);
  return result.patch;
}

/** Resolve the pinned revision to commits and list its files. */
export function manifestQuery(
  cwd: string,
  pr: PrBranches | undefined,
  pin: PinnedRevision
) {
  const source = pr?.sourceBranch ?? '';
  return queryOptions({
    queryKey: keys.prDiffManifest(
      cwd,
      pr?.id ?? 0,
      source,
      pin.target,
      pin.head ?? ''
    ),
    queryFn: () => measured('fetch', () => loadManifest(cwd, source, pin)),
    // A pinned head resolves the same way every time — its target commit
    // is pinned beside it once read — so the answer is kept until the
    // cache lets it go. Unpinned, the branch moves: read it again.
    staleTime: pin.head ? Infinity : 60_000,
  });
}

/** The patch between two commits, which never changes. */
export function patchQuery(cwd: string, comparison: PrComparison | null) {
  return queryOptions({
    queryKey: keys.prDiffPatch(
      cwd,
      comparison?.mergeBaseOid ?? '',
      comparison?.headOid ?? ''
    ),
    queryFn: () => measured('fetch', () => loadPatch(cwd, comparison!)),
    staleTime: Infinity,
  });
}
