import { useCallback, useMemo, useState } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import type { DiffLine } from '@n10/diff';
import type {
  PrComparison,
  PrDiffManifestFile,
} from '../../../host/contract.js';
import {
  planBatches,
  type BatchRead,
  type FileBody,
  type LargeScope,
} from '../diff/diff-bodies.js';
import {
  batchQuery,
  comparisonKey,
  readOf,
  type BatchData,
} from './pr-diff-batches.js';
import {
  bodiesOf,
  forComparison,
  heldReads,
  NOTHING,
  readIndex,
  withAlone,
  withRequested,
  withShown,
  type ReadIndex,
  type ReadPlan,
  type Requested,
} from './pr-diff-reads.js';

/**
 * The bodies of a pull request's files, read batch by batch as the
 * reader reaches them: `lib/diff/diff-bodies.ts` decides the batches,
 * `pr-diff-reads.ts` which reads are held, `pr-diff-batches.ts` how one
 * is made. A large file is read only when the reader picks how much of
 * it to read.
 */

export interface PrDiffBodies {
  /** Every manifest file in order, with its lines once read ([] until
   *  then) — the shape the diff list, highlighter and navigator take. */
  files: [string, DiffLine[]][];
  bodies: ReadonlyMap<string, FileBody>;
  /** The files the list shows now: their reads are held while shown. */
  showFiles: (paths: Iterable<string>) => void;
  /** Read the batches holding these files, among the recent few. */
  requestFiles: (paths: Iterable<string>) => void;
  /** Read one file on its own, by its changes or whole. */
  readAlone: (path: string, scope: LargeScope) => void;
  /** Read a failed file again — on its own, if its batch was cut. */
  retryFile: (path: string) => void;
  /** No read is in flight. */
  settled: boolean;
}

function useRequested(
  key: string,
  manifestFiles: readonly PrDiffManifestFile[]
) {
  const batches = useMemo(() => planBatches(manifestFiles), [manifestFiles]);
  const byPath = useMemo(
    () => new Map(manifestFiles.map((f) => [f.path, f])),
    [manifestFiles]
  );
  const [state, setState] = useState<Requested>(NOTHING);
  const requested = forComparison(state, key);
  const index = useMemo(
    () => readIndex(batches, byPath, requested.alone),
    [batches, byPath, requested.alone]
  );
  // Handing back the same state is how a change that changes nothing
  // skips the render.
  const update = useCallback(
    (change: (r: Requested) => Requested) =>
      setState((prev) => change(forComparison(prev, key))),
    [key]
  );
  const showFiles = useCallback(
    (paths: Iterable<string>) => update((r) => withShown(r, paths, index)),
    [index, update]
  );
  const requestFiles = useCallback(
    (paths: Iterable<string>) => update((r) => withRequested(r, paths, index)),
    [index, update]
  );
  const readAlone = useCallback(
    (path: string, scope: LargeScope) => {
      const file = byPath.get(path);
      if (file) update((r) => withAlone(r, file, scope));
    },
    [byPath, update]
  );
  return { requested, index, showFiles, requestFiles, readAlone };
}

interface Derived {
  files: [string, DiffLine[]][];
  bodies: ReadonlyMap<string, FileBody>;
  refetchOf: ReadonlyMap<string, () => void>;
  settled: boolean;
}

function derive(
  results: UseQueryResult<BatchData>[],
  reads: readonly ReadPlan[],
  manifestFiles: readonly PrDiffManifestFile[],
  index: ReadIndex
): Derived {
  const readById = new Map<string, BatchRead>();
  const refetchOf = new Map<string, () => void>();
  let settled = true;
  reads.forEach(({ batch, scope }, i) => {
    const result = results[i]!;
    readById.set(batch.id, readOf(result, batch, scope));
    // `refetch` settles with the result; it does not reject.
    refetchOf.set(batch.id, () => void result.refetch());
    if (result.isFetching) settled = false;
  });
  return {
    ...bodiesOf(manifestFiles, index, readById),
    refetchOf,
    settled,
  };
}

export function usePrDiffBodies(
  cwd: string,
  comparison: PrComparison | null,
  manifestFiles: readonly PrDiffManifestFile[]
): PrDiffBodies {
  const { requested, index, showFiles, requestFiles, readAlone } = useRequested(
    comparisonKey(comparison),
    manifestFiles
  );
  const reads = useMemo(
    () => (comparison ? heldReads(requested, index) : []),
    [comparison, requested, index]
  );

  const combine = useCallback(
    (results: UseQueryResult<BatchData>[]) =>
      derive(results, reads, manifestFiles, index),
    [reads, manifestFiles, index]
  );
  const { files, bodies, refetchOf, settled } = useQueries({
    queries: reads.map(({ batch, scope }) =>
      batchQuery(cwd, comparison!, batch, scope)
    ),
    combine,
  });

  const retryFile = useCallback(
    (path: string) => {
      const body = bodies.get(path);
      if (body?.state === 'error' && body.cut) {
        readAlone(path, 'whole-file');
        return;
      }
      const id = index.idOf.get(path);
      if (id) refetchOf.get(id)?.();
    },
    [bodies, index, refetchOf, readAlone]
  );

  return {
    files,
    bodies,
    showFiles,
    requestFiles,
    readAlone,
    retryFile,
    settled,
  };
}
