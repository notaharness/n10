import { queryOptions } from '@tanstack/react-query';
import type { PullRequestInfo } from '@n10/vcs-core';
import type { PrDiffError, PrDiffManifest } from '../../../host/contract.js';
import { keys } from '../data/query-keys.js';
import {
  readError,
  type DiffReadState,
  type QueryLike,
} from '../data/read-state.js';
import { measured } from '../perf.js';
import type { PinnedRevision } from './pinned-revisions.js';

/**
 * The read behind a pull request's diff — its comparison and file list
 * — as query options both the pane and Load new commits use, so either
 * one fills the cache the other reads.
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

/**
 * What the pane can say about the comparison: resolving it and listing
 * its files is the pane's read, and a failure there is the diff failing.
 * Each file's body has its own state (`use-pr-diff-bodies.ts`). No files
 * is "no changes" only when Git's listing was complete.
 */
export function prDiffReadState(
  manifest: QueryLike<PrDiffManifest>
): DiffReadState {
  if (manifest.data === undefined) {
    return manifest.error == null
      ? { kind: 'loading' }
      : { kind: 'failed', stage: 'fetch', error: readError(manifest.error) };
  }
  const stale =
    manifest.error == null
      ? null
      : { error: readError(manifest.error), since: manifest.dataUpdatedAt };
  const { files, complete } = manifest.data;
  return files.length === 0 && complete
    ? { kind: 'empty', stale }
    : { kind: 'ready', stale };
}
