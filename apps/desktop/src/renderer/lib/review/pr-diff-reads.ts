import type { DiffLine } from '@n10/diff';
import type { PrDiffManifestFile } from '../../../host/contract.js';
import {
  aloneBatch,
  bodyOf,
  type BatchRead,
  type DiffBatch,
  type FileBody,
  type LargeScope,
} from '../diff/diff-bodies.js';

/**
 * Which of a pull request's body reads are held, as plain data.
 *
 * What is held is bounded: the first batch, the reads for the files the
 * list shows, and the last few asked for anywhere else. A read that
 * drops out of that set loses its reader — a read still running is
 * cancelled, a finished one is released from the cache soon after — and
 * is made again when the reader comes back to its files.
 */

/** Reads held beyond the ones on screen, most recent first. */
export const KEPT_READS = 4;

export interface Requested {
  /** The comparison these requests belong to: a new one starts over. */
  key: string;
  /** The reads for the files the list shows now. */
  shown: readonly string[];
  /** Reads asked for anywhere, most recent first; the oldest drop. */
  recent: readonly string[];
  /** Files read on their own, at the scope asked for. */
  alone: ReadonlyMap<string, LargeScope>;
}

export const NOTHING: Requested = {
  key: '',
  shown: [],
  recent: [],
  alone: new Map(),
};

/** The requests for this comparison: another's are forgotten. */
export function forComparison(state: Requested, key: string): Requested {
  return state.key === key ? state : { ...NOTHING, key };
}

export interface ReadPlan {
  batch: DiffBatch;
  scope: LargeScope;
}

/** Every read a file could have, by id, and which one is each file's. */
export interface ReadIndex {
  byId: ReadonlyMap<string, ReadPlan>;
  idOf: ReadonlyMap<string, string>;
  first: string | null;
}

export function readIndex(
  batches: readonly DiffBatch[],
  byPath: ReadonlyMap<string, PrDiffManifestFile>,
  alone: ReadonlyMap<string, LargeScope>
): ReadIndex {
  const byId = new Map<string, ReadPlan>();
  const idOf = new Map<string, string>();
  for (const batch of batches) {
    byId.set(batch.id, { batch, scope: 'whole-file' });
    for (const f of batch.files) idOf.set(f, batch.id);
  }
  for (const [path, scope] of alone) {
    const file = byPath.get(path);
    if (!file) continue;
    const batch = aloneBatch(file, scope);
    byId.set(batch.id, { batch, scope });
    idOf.set(path, batch.id);
  }
  return { byId, idOf, first: batches[0]?.id ?? null };
}

function idsOf(paths: Iterable<string>, index: ReadIndex): string[] {
  const ids = new Set<string>();
  for (const p of paths) {
    const id = index.idOf.get(p);
    if (id) ids.add(id);
  }
  return [...ids];
}

/** `ids` to the front of `recent`, keeping at most `KEPT_READS`; the
 *  same list when that changes nothing. */
export function bump(
  recent: readonly string[],
  ids: readonly string[]
): readonly string[] {
  const next = [...ids, ...recent.filter((id) => !ids.includes(id))].slice(
    0,
    KEPT_READS
  );
  const same =
    next.length === recent.length && next.every((id, i) => id === recent[i]);
  return same ? recent : next;
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** The list now shows these files. Reads that left the screen join the
 *  recent few; those still on it are held as shown, and never push out
 *  a read asked for elsewhere — the walkthrough's, while the list sits
 *  behind it. The same state when nothing moved, so a scroll within the
 *  same reads does not render. */
export function withShown(
  r: Requested,
  paths: Iterable<string>,
  index: ReadIndex
): Requested {
  const ids = idsOf(paths, index);
  const recent = bump(
    r.recent,
    r.shown.filter((id) => !ids.includes(id))
  );
  if (recent === r.recent && sameIds(ids, r.shown)) return r;
  return { ...r, shown: ids, recent };
}

/** Read these files' batches, among the recent few. */
export function withRequested(
  r: Requested,
  paths: Iterable<string>,
  index: ReadIndex
): Requested {
  const recent = bump(r.recent, idsOf(paths, index));
  return recent === r.recent ? r : { ...r, recent };
}

/** Read this file on its own, at this scope. */
export function withAlone(
  r: Requested,
  file: PrDiffManifestFile,
  scope: LargeScope
): Requested {
  return {
    ...r,
    alone: new Map(r.alone).set(file.path, scope),
    recent: bump(r.recent, [aloneBatch(file, scope).id]),
  };
}

/** The reads held now: the first batch, those on screen, the recent. */
export function heldReads(requested: Requested, index: ReadIndex): ReadPlan[] {
  const ids = new Set<string>();
  if (index.first) ids.add(index.first);
  for (const id of requested.shown) ids.add(id);
  for (const id of requested.recent) ids.add(id);
  return [...ids].flatMap((id) => {
    const plan = index.byId.get(id);
    return plan ? [plan] : [];
  });
}

const IDLE: BatchRead = { status: 'idle' };

/**
 * Each file's body from the reads held (`readById`). A file whose read
 * is not held is idle, read again when the reader reaches it; one with
 * no read at all is a large file nobody has asked for.
 */
export function bodiesOf(
  manifestFiles: readonly PrDiffManifestFile[],
  index: ReadIndex,
  readById: ReadonlyMap<string, BatchRead>
): { files: [string, DiffLine[]][]; bodies: Map<string, FileBody> } {
  const bodies = new Map<string, FileBody>();
  const files: [string, DiffLine[]][] = [];
  for (const file of manifestFiles) {
    const id = index.idOf.get(file.path);
    const read = id === undefined ? null : readById.get(id) ?? IDLE;
    const body = bodyOf(file, read);
    bodies.set(file.path, body);
    files.push([file.path, body.state === 'loaded' ? body.lines : []]);
  }
  return { files, bodies };
}
