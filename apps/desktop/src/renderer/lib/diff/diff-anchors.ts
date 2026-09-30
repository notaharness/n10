import type { DiffLine } from '@n10/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import type { InlineTarget } from '../review/my-drafts.js';
import { anchorKey, lineAnchors } from './diff-model.js';
import type { FlatRow } from './diff-virtual.js';

/** Where comments hang in the flat diff: the line each one ends on, or
 *  the file's tail when its line is not in the diff. */

export /** Group agent drafts / remote threads by the anchor they sit under. */
function anchorComments<T extends { side: 'LEFT' | 'RIGHT' }>(
  present: ReadonlySet<string>,
  items: readonly T[],
  lineFor: (t: T) => number | null
): { byAnchor: Map<string, T[]>; orphans: T[]; pinned: Set<string> } {
  const byAnchor = new Map<string, T[]>();
  const orphans: T[] = [];
  const pinned = new Set<string>();
  for (const t of items) {
    const line = lineFor(t);
    if (line == null) {
      orphans.push(t);
      continue;
    }
    const a = anchorKey(t.side === 'LEFT' ? 'L' : 'R', line);
    if (present.has(a)) {
      (byAnchor.get(a) ?? byAnchor.set(a, []).get(a)!).push(t);
      pinned.add(a);
    } else {
      orphans.push(t);
    }
  }
  return { byAnchor, orphans, pinned };
}

/** Every anchor key this file's lines can carry a comment on. */
export function presentAnchors(lines: readonly DiffLine[]): Set<string> {
  const present = new Set<string>();
  for (const l of lines) for (const a of lineAnchors(l)) present.add(a);
  return present;
}

/**
 * The tail row under a file, holding comments whose anchor line the
 * diff doesn't contain. Emits nothing when there are none.
 */
export function pushOrphans(
  rows: FlatRow[],
  indexById: Map<string, number>,
  file: string,
  threads: RemoteCommentThread[],
  drafts: ReviewComment[],
  mine: InlineTarget[]
): void {
  if (threads.length + drafts.length + mine.length === 0) return;
  const index = rows.length;
  rows.push({ key: `o:${file}`, kind: 'orphans', file, threads, drafts, mine });
  for (const x of threads) indexById.set(x.id, index);
  for (const x of drafts) indexById.set(x.id, index);
  for (const x of mine) indexById.set(x.key, index);
}

/** The reviewer's own drafts on a file: on its lines, or on all of it. */
export function splitMine(mine: readonly InlineTarget[]) {
  const onLines: (InlineTarget & { side: 'LEFT' | 'RIGHT' })[] = [];
  const onFile: InlineTarget[] = [];
  for (const m of mine) {
    if (m.anchor.range) onLines.push({ ...m, side: m.anchor.range.side });
    else onFile.push(m);
  }
  return { onLines, onFile };
}
