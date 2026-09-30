import { useCallback, useEffect, useState } from 'react';
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  PrComparison,
  PrDiffManifest,
  PrDiffPatch,
} from '../../../host/contract.js';
import { readError, type QueryLike } from '../data/read-state.js';
import {
  movedFrom,
  pinKey,
  setPin,
  shouldFollow,
  updatePin,
  usePinnedRevision,
  type MovedRevision,
  type PinnedRevision,
  type ReportedRevision,
} from './pinned-revisions.js';
import {
  manifestQuery,
  patchQuery,
  type PrBranches,
} from './pr-diff-queries.js';

/**
 * A pull request's diff, read at exact commits.
 *
 * The host resolves the pull request — its branches plus the head the
 * provider reported — to a merge base and a head commit, and the patch
 * is read between those. A head this clone cannot produce is an error
 * that says so, never the local branch's diff shown in its place.
 *
 * The revision is pinned (`pinned-revisions.ts`): when the provider
 * reports a newer head or another target, the diff on screen stays
 * where the reader is and `moved` offers the new one, instead of the
 * next list poll or a remount swapping the code out from under them.
 * Loading it reads the new comparison first and moves the pin only once
 * that read succeeds, so a failed load leaves the diff as it was.
 */

export { PrDiffLoadError } from './pr-diff-queries.js';

export interface PrDiffTruncation {
  limitBytes: number;
  /** Files the manifest lists; the patch holds fewer. */
  manifestFiles: number;
  /** False when the manifest itself was cut: there may be more. */
  manifestComplete: boolean;
}

/** Loading the revision the provider reports now. */
export interface LoadMoved {
  run: () => void;
  loading: boolean;
  /** Why the last attempt failed; the diff on screen is unchanged. */
  error: string | null;
}

/** What the diff pane says about the comparison, beside its files. */
export interface PrDiffView {
  comparison: PrComparison | null;
  /** The target branch the diff on screen is compared with, which a
   *  retarget does not change until the reader loads it. */
  target: string;
  truncated: PrDiffTruncation | null;
  /** What the provider reports that the diff on screen is not at. */
  moved: MovedRevision | null;
  loadMoved: LoadMoved;
}

/**
 * The patch read, in the shape the read-state model takes: resolution
 * and the read after it are one read to the reader, and either failing
 * is the diff failing.
 */
export interface PrDiffRead {
  patch: QueryLike<string> & { isFetching: boolean };
  /** Names this read, so a held failure never outlives it. */
  key: readonly unknown[];
  /** Read again from where it failed: a fetch may now succeed. */
  retry: () => Promise<unknown>;
  view: PrDiffView;
}

function truncationOf(
  patch: PrDiffPatch | undefined,
  manifest: PrDiffManifest | undefined
): PrDiffTruncation | null {
  if (!patch?.truncated || !manifest) return null;
  return {
    limitBytes: patch.limitBytes,
    manifestFiles: manifest.files.length,
    manifestComplete: manifest.complete,
  };
}

/**
 * Keep what the pin learns as its reads land: the target commit it
 * resolved to, and that its diff reached the screen.
 */
function useRecordPin(
  key: string,
  pin: PinnedRevision,
  comparison: PrComparison | null,
  shown: boolean
) {
  const targetOid = pin.head ? comparison?.targetOid : undefined;
  useEffect(() => {
    if (targetOid) updatePin(key, { targetOid });
  }, [key, targetOid]);
  useEffect(() => {
    if (shown) updatePin(key, { shown: true });
  }, [key, shown]);
}

/**
 * Load what the provider reports: read the new comparison and its patch
 * first, then move the pin. A failure keeps the pin — and the diff on
 * screen — and says why.
 */
function useLoadMoved(
  cwd: string,
  pr: PrBranches | undefined,
  key: string,
  reported: ReportedRevision
): LoadMoved {
  const queryClient = useQueryClient();
  const attempt = `${key}|${reported.head ?? ''}|${reported.target}`;
  const [state, setState] = useState({
    attempt: '',
    loading: false,
    error: '',
  });
  const current = state.attempt === attempt ? state : null;
  const { head, target } = reported;
  const run = useCallback(() => {
    if (current?.loading) return;
    setState({ attempt, loading: true, error: '' });
    const next: PinnedRevision = { head, target };
    const load = async () => {
      const manifest = await queryClient.query(manifestQuery(cwd, pr, next));
      await queryClient.query(patchQuery(cwd, manifest.comparison));
      setPin(key, { ...next, targetOid: manifest.comparison.targetOid });
    };
    // Both handlers attached: the chain cannot reject.
    void load().then(
      () => setState({ attempt, loading: false, error: '' }),
      (e: unknown) => setState({ attempt, loading: false, error: readError(e) })
    );
  }, [current?.loading, attempt, head, target, queryClient, cwd, pr, key]);
  return {
    run,
    loading: current?.loading ?? false,
    error: current?.error || null,
  };
}

/**
 * What the provider reports that the pin does not hold — followed at
 * once when the pinned read failed with nothing on screen to keep.
 */
function useFollow(
  key: string,
  pin: PinnedRevision,
  reported: ReportedRevision,
  readFailed: boolean
): MovedRevision | null {
  const moved = movedFrom(pin, reported);
  const follow = shouldFollow(pin, moved, readFailed);
  const { head, target } = reported;
  useEffect(() => {
    if (follow) setPin(key, { head, target });
  }, [follow, key, head, target]);
  return moved;
}

/**
 * Resolution failed, or the read after it did: retry that one, and
 * settle only once the patch is in, so Retry spins for the whole read.
 */
async function retryRead(
  queryClient: QueryClient,
  cwd: string,
  manifest: UseQueryResult<PrDiffManifest>,
  patch: UseQueryResult<PrDiffPatch>
): Promise<unknown> {
  if (!manifest.error) return patch.refetch();
  const { data } = await manifest.refetch();
  if (!data) return undefined;
  return queryClient.query(patchQuery(cwd, data.comparison));
}

function reportedOf(pr: PrBranches | undefined): ReportedRevision {
  return { head: pr?.headSha, target: pr?.targetBranch ?? '' };
}

/** The manifest at the pin, then the patch between its commits. */
function useReads(
  cwd: string,
  pr: PrBranches | undefined,
  pin: PinnedRevision,
  enabled: boolean
) {
  const manifestOptions = manifestQuery(cwd, pr, pin);
  const manifest = useQuery({ ...manifestOptions, enabled: enabled && !!pr });
  const comparison = manifest.data?.comparison ?? null;
  const patch = useQuery({
    ...patchQuery(cwd, comparison),
    enabled: enabled && comparison !== null,
  });
  return { key: manifestOptions.queryKey, manifest, comparison, patch };
}

export function usePrDiff(
  cwd: string,
  pr: PrBranches | undefined,
  opts: { enabled: boolean }
): PrDiffRead {
  const queryClient = useQueryClient();
  const key = pinKey(cwd, pr?.id ?? 0);
  const reported = reportedOf(pr);
  const pin = usePinnedRevision(key, reported);
  const { manifest, comparison, patch, ...read } = useReads(
    cwd,
    pr,
    pin,
    opts.enabled
  );
  const error = manifest.error ?? patch.error;
  const shown = patch.data !== undefined;
  useRecordPin(key, pin, comparison, shown);
  const moved = useFollow(key, pin, reported, error !== null && !shown);
  const loadMoved = useLoadMoved(cwd, pr, key, reported);
  return {
    patch: {
      data: patch.data?.text,
      error,
      dataUpdatedAt: patch.dataUpdatedAt,
      isFetching: manifest.isFetching || patch.isFetching,
    },
    key: read.key,
    retry: () => retryRead(queryClient, cwd, manifest, patch),
    view: {
      comparison,
      target: pin.target,
      truncated: truncationOf(patch.data, manifest.data),
      moved,
      loadMoved,
    },
  };
}
