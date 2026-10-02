import { isOid, type Oid, type PullRequestRef } from '@n10/vcs-core';
import {
  prScope,
  prStoreDir,
  readPrStoreFile,
  writePrStoreFile,
} from './pr-store-file.js';

/**
 * Where a reader has been in a pull request: the exact commits of each
 * visit, kept per account and pull request outside the repository
 * (`pr-store-file.ts`).
 *
 * "Since your last visit" compares against the last visit before the
 * current one began. A visit is the caller's to name (`visitId`): the
 * renderer starts one when the reader comes to the pull request, reads
 * its history (which fixes the baseline), and reuses the id for every
 * read, refresh and record within it, so looking again does not move
 * the baseline — otherwise the second look at a new push would show
 * nothing new. A first visit has no baseline at all, rather than one
 * made up.
 */

export interface Checkpoint {
  /** The head the reader saw. */
  head: Oid;
  /** The target commit it was compared against, and where they met. */
  target: Oid;
  mergeBase: Oid;
  /** When the reader was last at it, in ms since the epoch. */
  at: number;
}

export interface Checkpoints {
  /** Oldest first, at most `KEPT_VISITS`. */
  visits: Checkpoint[];
  /** The head of the reader's latest submitted review, as the provider
   *  last reported it: kept so it outlives a force-push. */
  reviewed: Oid | null;
}

export const KEPT_VISITS = 10;

export function defaultCheckpointDir(): string {
  return prStoreDir('review-checkpoints');
}

const NONE: Checkpoints = { visits: [], reviewed: null };

function parseCheckpoint(value: unknown): Checkpoint {
  const { head, target, mergeBase, at } = (value ?? {}) as Record<
    string,
    unknown
  >;
  if (!isOid(head) || !isOid(target) || !isOid(mergeBase)) {
    throw new TypeError('a visit without its commits');
  }
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    throw new TypeError('a visit without its time');
  }
  return { head, target, mergeBase, at };
}

function parseCheckpoints(data: unknown): Checkpoints {
  const { visits, reviewed = null } = (data ?? {}) as Record<string, unknown>;
  if (!Array.isArray(visits)) throw new TypeError('no visits');
  if (reviewed !== null && !isOid(reviewed)) {
    throw new TypeError('a reviewed head that is not a commit');
  }
  return { visits: visits.map(parseCheckpoint), reviewed };
}

export function readCheckpoints(
  dir: string,
  ref: PullRequestRef,
  viewer: string | null
): Checkpoints {
  return readPrStoreFile(dir, ref, viewer, parseCheckpoints, NONE).data;
}

const sameCommits = (a: Checkpoint, b: Checkpoint) =>
  a.head === b.head && a.target === b.target && a.mergeBase === b.mergeBase;

/** `visits` with this one last: the newest again only moves its time. */
export function withVisit(
  visits: readonly Checkpoint[],
  visit: Checkpoint
): Checkpoint[] {
  const last = visits.at(-1);
  const rest = last && sameCommits(last, visit) ? visits.slice(0, -1) : visits;
  return [...rest, visit].slice(-KEPT_VISITS);
}

/** What one visit records: the commits shown, and the reviewed head
 *  when the caller knows it (undefined keeps the one recorded). */
export interface VisitRecord {
  visit: Checkpoint;
  reviewed?: Oid | null;
}

/** The record for this account and pull request, after a visit. */
export function writeVisit(
  dir: string,
  ref: PullRequestRef,
  viewer: string | null,
  record: VisitRecord
): Checkpoints {
  const file = readPrStoreFile(dir, ref, viewer, parseCheckpoints, NONE);
  const saved = file.data;
  const data: Checkpoints = {
    visits: withVisit(saved.visits, record.visit),
    reviewed: record.reviewed === undefined ? saved.reviewed : record.reviewed,
  };
  // A ref with no id keeps the one stored: dropping it would let a
  // repository later replaced at this path read these visits as its own.
  const id = ref.id ?? file.ref.id;
  writePrStoreFile(dir, {
    ref: id === undefined ? ref : { ...ref, id },
    viewer,
    data,
  });
  return data;
}

/** Visits remembered per pull request: a read still in flight from
 *  the one before must not unsettle the current one's baseline. */
export const RECENT_VISITS = 4;

interface Frozen {
  baseline: Checkpoint | null;
  /** The pull request as the visit's history read confirmed it. */
  ref: PullRequestRef;
}

/**
 * Each pull request's last visit as it stood when a visit began, per
 * account, for the last few visits. A visit is recorded under the ref
 * its history read confirmed — the repository id the provider named —
 * never under one the caller only claimed: the id decides whether a
 * stored record belongs to a repository since replaced at its path.
 */
export class VisitBaselines {
  private readonly frozen = new Map<string, Map<string, Frozen>>();

  constructor(private readonly dir: string) {}

  /** The last visit before `visitId` began; null on a first visit.
   *  `ref` is the pull request as this visit's history read confirmed
   *  it, and is what the visit is recorded under. */
  lastVisit(
    ref: PullRequestRef,
    viewer: string | null,
    visitId: string
  ): Checkpoint | null {
    const visits = this.visitsOf(ref, viewer);
    const held = visits.get(visitId);
    if (held) return held.baseline;
    const baseline = readCheckpoints(this.dir, ref, viewer).visits.at(-1);
    visits.set(visitId, { baseline: baseline ?? null, ref });
    const oldest = visits.keys().next().value;
    if (visits.size > RECENT_VISITS && oldest !== undefined) {
      visits.delete(oldest);
    }
    return baseline ?? null;
  }

  /** Record what `visitId` showed. Its history must have been read:
   *  that read froze the baseline and confirmed the ref. The baseline
   *  is returned with the record, to be kept alongside it. */
  record(
    ref: PullRequestRef,
    viewer: string | null,
    visitId: string,
    record: VisitRecord
  ): Checkpoints & { baseline: Checkpoint | null } {
    const held = this.visitsOf(ref, viewer).get(visitId);
    if (!held) {
      throw new Error(
        'A visit is recorded after its pull request history is read, and this one’s was not, or its last visit could not be'
      );
    }
    const kept = writeVisit(this.dir, held.ref, viewer, record);
    return { ...kept, baseline: held.baseline };
  }

  private visitsOf(
    ref: PullRequestRef,
    viewer: string | null
  ): Map<string, Frozen> {
    const key = prScope(ref, viewer);
    let visits = this.frozen.get(key);
    if (!visits) {
      visits = new Map();
      this.frozen.set(key, visits);
    }
    return visits;
  }
}
