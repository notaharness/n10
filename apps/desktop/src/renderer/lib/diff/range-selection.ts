import type { DiffLine } from '@n10/diff';
import type { LineRange } from '../../../host/contract.js';

/**
 * Which lines a reviewer has picked to comment on. A selection is one
 * file and one side: GitHub and Azure both anchor a comment to a run of
 * lines on the old side or the new side, and a run that crosses files
 * or sides cannot be one comment.
 *
 * The side is part of the line's identity, never of the view: a
 * removed line is LEFT and an added one RIGHT; an unchanged line is
 * RIGHT in the unified view and whichever column was used in the split
 * view. Switching views therefore never swaps a selection's side.
 */

export type DiffSide = 'LEFT' | 'RIGHT';

export interface LinePoint {
  file: string;
  side: DiffSide;
  line: number;
}

export interface LineSelection {
  file: string;
  side: DiffSide;
  /** Where the selection started; extending moves `head` only. */
  anchor: number;
  head: number;
}

/** The point a unified row stands for when its gutter is used. */
export function unifiedPoint(file: string, line: DiffLine): LinePoint | null {
  if (line.type === 'remove' && line.oldLine != null) {
    return { file, side: 'LEFT', line: line.oldLine };
  }
  if (line.newLine != null && line.type !== 'hunk-header') {
    return { file, side: 'RIGHT', line: line.newLine };
  }
  return null;
}

/** The point one column of a split row stands for. */
export function splitPoint(
  file: string,
  line: DiffLine,
  column: 'L' | 'R'
): LinePoint | null {
  const n = column === 'L' ? line.oldLine : line.newLine;
  if (n == null || line.type === 'hunk-header') return null;
  return { file, side: column === 'L' ? 'LEFT' : 'RIGHT', line: n };
}

export function select(point: LinePoint): LineSelection {
  return {
    file: point.file,
    side: point.side,
    anchor: point.line,
    head: point.line,
  };
}

/**
 * Extend `sel` to `point`. A point in another file or on the other side
 * starts a new selection there instead: one comment cannot span them.
 */
export function extend(
  sel: LineSelection | null,
  point: LinePoint
): LineSelection {
  if (!sel || sel.file !== point.file || sel.side !== point.side) {
    return select(point);
  }
  return { ...sel, head: point.line };
}

/**
 * Extend `sel` to `point` when every line between them on that side is
 * on screen among `points`, else null. A range covers exactly what is
 * highlighted: in the unified view an old-side range is a run of
 * removed lines (unchanged lines between them stand for the new side),
 * and no range reaches across lines a fold hides.
 */
export function extendOnScreen(
  points: readonly LinePoint[],
  sel: LineSelection | null,
  point: LinePoint
): LineSelection | null {
  const next = extend(sel, point);
  const { start, end } = selectionRange(next);
  const shown = new Set(
    points
      .filter((p) => p.file === next.file && p.side === next.side)
      .map((p) => p.line)
  );
  for (let n = start; n <= end; n++) if (!shown.has(n)) return null;
  return next;
}

/**
 * Whether a selection shows in the view: every new-side line and every
 * removed line is a point in both views, but an unchanged line stands
 * for its old side only in Split.
 */
export function shownIn(
  sel: LineSelection,
  split: boolean,
  lines: readonly DiffLine[]
): boolean {
  if (split || sel.side === 'RIGHT') return true;
  const removed = new Set(
    lines.flatMap((l) => (l.type === 'remove' && l.oldLine ? [l.oldLine] : []))
  );
  const { start, end } = selectionRange(sel);
  for (let n = start; n <= end; n++) if (!removed.has(n)) return false;
  return true;
}

export function selectionRange(sel: LineSelection): LineRange {
  return {
    startSide: sel.side,
    start: Math.min(sel.anchor, sel.head),
    side: sel.side,
    end: Math.max(sel.anchor, sel.head),
  };
}

export function isSelected(
  sel: LineSelection | null,
  point: LinePoint | null
): boolean {
  if (!sel || !point) return false;
  if (sel.file !== point.file || sel.side !== point.side) return false;
  const { start, end } = selectionRange(sel);
  return point.line >= start && point.line <= end;
}

/** The lines of `file` a range covers, in order, for the draft to keep
 *  as the code it was written on. */
export function rangeSource(
  lines: readonly DiffLine[],
  range: LineRange
): string[] {
  const numberOf = (l: DiffLine) =>
    range.side === 'LEFT' ? l.oldLine : l.newLine;
  return lines
    .filter((l) => {
      if (l.type === 'hunk-header') return false;
      if (range.side === 'LEFT' ? l.type === 'add' : l.type === 'remove') {
        return false;
      }
      const n = numberOf(l);
      return n != null && n >= range.start && n <= range.end;
    })
    .map((l) => l.content);
}

export function samePoint(a: LinePoint | null, b: LinePoint | null): boolean {
  return (
    a != null &&
    b != null &&
    a.file === b.file &&
    a.side === b.side &&
    a.line === b.line
  );
}

/** Where the selection's moving end is. */
export function headPoint(sel: LineSelection): LinePoint {
  return { file: sel.file, side: sel.side, line: sel.head };
}

/**
 * The point after (or before) `from` among `points`, which are one
 * file's lines in the order they are on screen. With `sameSide`, lines
 * on the other side are stepped over: a range stays on one side, and a
 * split view's column is its side.
 */
export function neighbour(
  points: readonly LinePoint[],
  from: LinePoint,
  dir: 1 | -1,
  sameSide: boolean
): LinePoint | null {
  const at = points.findIndex((p) => samePoint(p, from));
  if (at < 0) return null;
  for (let i = at + dir; i >= 0 && i < points.length; i += dir) {
    const p = points[i]!;
    if (!sameSide || p.side === from.side) return p;
  }
  return null;
}

/**
 * The other column of the same split row, left or right of `from`:
 * `points` holds a row's cells old side first, and `rowOf` says which
 * row a point sits in. Null for a row with one side only.
 */
export function across(
  points: readonly LinePoint[],
  from: LinePoint,
  dir: 1 | -1,
  rowOf: (p: LinePoint) => number | undefined
): LinePoint | null {
  const at = points.findIndex((p) => samePoint(p, from));
  const p = at < 0 ? undefined : points[at + dir];
  return p && rowOf(p) === rowOf(from) ? p : null;
}

/** "new lines 41–43", "old line 18": the words a composer names its
 *  place with. */
export function rangeWords(range: LineRange): string {
  const side = range.side === 'LEFT' ? 'old' : 'new';
  return range.start === range.end
    ? `${side} line ${range.start}`
    : `${side} lines ${range.start}–${range.end}`;
}
