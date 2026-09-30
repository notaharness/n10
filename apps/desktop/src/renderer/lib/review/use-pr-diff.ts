import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PrComparison,
  PrDiffManifestFile,
} from '../../../host/contract.js';
import { readError, type DiffReadState } from '../data/read-state.js';
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
import { planBatches } from '../diff/diff-bodies.js';
import { batchQuery } from './pr-diff-batches.js';
import {
  manifestQuery,
  prDiffReadState,
  type PrBranches,
} from './pr-diff-queries.js';
import { usePrDiffBodies, type PrDiffBodies } from './use-pr-diff-bodies.js';

/**
 * A pull request's diff, read at exact commits.
 *
 * The host resolves the pull request — its branches plus the head the
 * provider reported — to a merge base and a head commit, and lists
 * every file changed between them. Their bodies are read between the
 * same two commits, a batch at a time (`use-pr-diff-bodies.ts`). A head
 * this clone cannot produce is an error that says so, never the local
 * branch's diff shown in its place.
 *
 * The revision is pinned (`pinned-revisions.ts`): when the provider
 * reports a newer head or another target, the diff on screen stays
 * where the reader is and `moved` offers the new one, instead of the
 * next list poll or a remount swapping the code out from under them.
 * Loading it resolves the new comparison, lists its files and reads
 * their first batch before the pin moves, so a failed load leaves the
 * diff as it was and a successful one swaps it in a single step.
 */

export { PrDiffLoadError } from './pr-diff-queries.js';

/** Loading the revision the provider reports now. */
export interface LoadMoved {
  run: () => void;
  loading: boolean;
  /** Why the last attempt failed; the diff on screen is unchanged. */
  error: string | null;
}

interface LineCounts {
  additions: number;
  deletions: number;
}

/** What the diff pane says about the comparison, beside its files. */
export interface PrDiffView extends PrDiffBodies {
  comparison: PrComparison | null;
  /** The target branch the diff on screen is compared with, which a
   *  retarget does not change until the reader loads it. */
  target: string;
  /** What the provider reports that the diff on screen is not at. */
  moved: MovedRevision | null;
  loadMoved: LoadMoved;
  /** Every changed file, in Git's order, and by path. */
  manifestFiles: readonly PrDiffManifestFile[];
  manifestByPath: ReadonlyMap<string, PrDiffManifestFile>;
  /** Changed-line counts per file, where Git counted them: they hold
   *  before a file's body is read. */
  counts: ReadonlyMap<string, LineCounts>;
  /** Git's listing of the files was cut: some may be missing. */
  incomplete: boolean;
}

/**
 * The pull request's diff as the review workspace takes it: the pane's
 * read (resolving the comparison and listing its files) in the
 * read-state model's terms, and the view of the files themselves.
 */
export interface PrDiffRead {
  state: DiffReadState;
  fetching: boolean;
  /** Names this read, so a held failure never outlives it. */
  key: readonly unknown[];
  /** Resolve and list again: a fetch may now succeed. */
  retry: () => Promise<unknown>;
  view: PrDiffView;
}

const NO_FILES: readonly PrDiffManifestFile[] = [];

function useManifestMaps(files: readonly PrDiffManifestFile[]) {
  return useMemo(() => {
    const manifestByPath = new Map(files.map((f) => [f.path, f]));
    const counts = new Map<string, LineCounts>();
    for (const f of files) {
      if (f.additions !== null && f.deletions !== null) {
        counts.set(f.path, { additions: f.additions, deletions: f.deletions });
      }
    }
    return { manifestByPath, counts };
  }, [files]);
}

/** Keep the target commit the pin resolved to, and that its file list
 *  reached the screen. */
function useRecordPin(
  key: string,
  pin: PinnedRevision,
  comparison: PrComparison | null
) {
  const targetOid = pin.head ? comparison?.targetOid : undefined;
  useEffect(() => {
    if (targetOid) updatePin(key, { targetOid });
  }, [key, targetOid]);
  const shown = comparison !== null;
  useEffect(() => {
    if (shown) updatePin(key, { shown: true });
  }, [key, shown]);
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
 * Load what the provider reports: resolve the new comparison, list its
 * files and read the first batch, then move the pin. A failure keeps
 * the pin — and the diff on screen — and says why.
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
      const { comparison, files } = await queryClient.query(
        manifestQuery(cwd, pr, next)
      );
      const first = planBatches(files)[0];
      if (first) {
        await queryClient.query(
          batchQuery(cwd, comparison, first, 'whole-file')
        );
      }
      setPin(key, { ...next, targetOid: comparison.targetOid });
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

function reportedOf(pr: PrBranches | undefined): ReportedRevision {
  return { head: pr?.headSha, target: pr?.targetBranch ?? '' };
}

export function usePrDiff(
  cwd: string,
  pr: PrBranches | undefined,
  opts: { enabled: boolean }
): PrDiffRead {
  const key = pinKey(cwd, pr?.id ?? 0);
  const reported = reportedOf(pr);
  const pin = usePinnedRevision(key, reported);
  const options = manifestQuery(cwd, pr, pin);
  const manifest = useQuery({ ...options, enabled: opts.enabled && !!pr });
  const comparison = manifest.data?.comparison ?? null;
  const manifestFiles = manifest.data?.files ?? NO_FILES;
  const bodies = usePrDiffBodies(cwd, comparison, manifestFiles);
  const maps = useManifestMaps(manifestFiles);
  useRecordPin(key, pin, comparison);
  const readFailed = manifest.error !== null && comparison === null;
  const moved = useFollow(key, pin, reported, readFailed);
  const loadMoved = useLoadMoved(cwd, pr, key, reported);
  return {
    state: prDiffReadState(manifest),
    fetching: manifest.isFetching,
    key: options.queryKey,
    retry: () => manifest.refetch(),
    view: {
      ...bodies,
      ...maps,
      comparison,
      target: pin.target,
      moved,
      loadMoved,
      manifestFiles,
      incomplete: manifest.data ? !manifest.data.complete : false,
    },
  };
}
