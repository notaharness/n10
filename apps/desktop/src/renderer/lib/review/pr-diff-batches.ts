import { queryOptions } from '@tanstack/react-query';
import type { ParsedDiffFile } from '@n10/diff';
import type { PrComparison } from '../../../host/contract.js';
import { keys } from '../data/query-keys.js';
import { createReadSlots } from '../data/read-slots.js';
import {
  CHANGES_CONTEXT,
  mispaired,
  pathspecOf,
  type BatchRead,
  type DiffBatch,
  type LargeScope,
} from '../diff/diff-bodies.js';
import { parseDiffFilesInWorker } from '../diff/diff-worker-client.js';
import { measured } from '../perf.js';
import { PrDiffLoadError } from './pr-diff-queries.js';

/**
 * Reading one batch of a pull request's file bodies: the query every
 * reader of a batch shares, so a batch prefetched before the pin moves
 * is the one the diff then shows.
 */

export interface BatchData {
  files: ReadonlyMap<string, ParsedDiffFile>;
  truncated: boolean;
  limitBytes: number;
}

/** Git reads in flight at once. Each is a process in the main process
 *  and a string of up to the patch ceiling over IPC; a reader dragging
 *  the scrollbar through a big pull request must not start one per
 *  batch it passes. */
const slots = createReadSlots(2);

interface PatchRead {
  files: Map<string, ParsedDiffFile>;
  truncated: boolean;
  limitBytes: number;
}

/** One patch read, parsed, keeping only `wanted`'s files: a rename's
 *  other path can come back with them. */
async function readPatch(
  cwd: string,
  comparison: PrComparison,
  req: { pathspec: string[]; wanted: readonly string[]; scope: LargeScope },
  signal: AbortSignal
): Promise<PatchRead> {
  const result = await slots.run(signal, () =>
    measured('fetch', () =>
      window.n10.fetchPrDiffPatch({
        repo: cwd,
        mergeBaseOid: comparison.mergeBaseOid,
        headOid: comparison.headOid,
        paths: req.pathspec,
        ...(req.scope === 'changes' ? { context: CHANGES_CONTEXT } : {}),
      })
    )
  );
  if (!result.ok) throw new PrDiffLoadError(result.error);
  const wanted = new Set(req.wanted);
  const parsed = await parseDiffFilesInWorker(result.patch.text, signal);
  return {
    files: new Map(
      parsed.filter((f) => wanted.has(f.path)).map((f) => [f.path, f])
    ),
    truncated: result.patch.truncated,
    limitBytes: result.patch.limitBytes,
  };
}

/**
 * Read a batch, then read alone any file it paired otherwise than the
 * manifest (`mispaired`): by its own paths, a file pairs as it did
 * across the whole pull request.
 */
async function readBatch(
  cwd: string,
  comparison: PrComparison,
  batch: DiffBatch,
  scope: LargeScope,
  signal: AbortSignal
): Promise<BatchData> {
  const read = await readPatch(
    cwd,
    comparison,
    { pathspec: batch.pathspec, wanted: batch.files, scope },
    signal
  );
  if (batch.files.length === 1) return read;
  for (const path of mispaired(batch, read.files)) {
    const shape = batch.shapes.get(path)!;
    const alone = await readPatch(
      cwd,
      comparison,
      { pathspec: pathspecOf({ path, ...shape }), wanted: [path], scope },
      signal
    );
    const file = alone.files.get(path);
    if (file) read.files.set(path, file);
    else read.files.delete(path);
  }
  return read;
}

/** What names a comparison's reads: a new one starts over. */
export function comparisonKey(comparison: PrComparison | null): string {
  return comparison ? `${comparison.mergeBaseOid}..${comparison.headOid}` : '';
}

/** How long a batch no reader holds stays cached: long enough to scroll
 *  back to it, short enough that a long read-through lets go. */
const RELEASED_BATCH_MS = 30_000;

export function batchQuery(
  cwd: string,
  comparison: PrComparison,
  batch: DiffBatch,
  scope: LargeScope
) {
  return queryOptions({
    queryKey: keys.prDiffBatch(cwd, comparisonKey(comparison), batch.id),
    queryFn: ({ signal }) => readBatch(cwd, comparison, batch, scope, signal),
    // Two commits never change what is between them.
    staleTime: Infinity,
    gcTime: RELEASED_BATCH_MS,
  });
}

/** A batch query's state in `bodyOf`'s terms. */
export function readOf(
  result: { status: string; data?: BatchData; error: Error | null },
  batch: DiffBatch,
  scope: LargeScope
): BatchRead {
  if (result.status === 'error') {
    return { status: 'error', message: result.error?.message ?? 'Failed' };
  }
  if (result.status === 'success' && result.data) {
    return {
      status: 'success',
      ...result.data,
      scope,
      alone: batch.files.length === 1,
    };
  }
  return { status: 'pending' };
}
