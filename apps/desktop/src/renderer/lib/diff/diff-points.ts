import type { DiffLine } from '@n10/diff';
import type { FlatRow } from './diff-virtual.js';
import { splitPoint, unifiedPoint, type LinePoint } from './range-selection.js';

/**
 * The lines on screen that a comment can be placed on, file by file in
 * screen order, and the row each sits in. Folded lines are not on
 * screen and are not stepped onto: moving past a fold lands on the
 * next line that is shown.
 */
export interface LinePoints {
  byFile: Map<string, LinePoint[]>;
  rowOf: Map<string, number>;
}

export function pointKey(p: LinePoint): string {
  return JSON.stringify([p.file, p.side, p.line]);
}

function pointsOfRow(
  row: FlatRow,
  lines: ReadonlyMap<string, DiffLine[]>
): (LinePoint | null)[] {
  switch (row.kind) {
    case 'unified':
      return [unifiedPoint(row.file, lines.get(row.file)![row.index]!)];
    case 'split-context': {
      const line = lines.get(row.file)![row.index]!;
      return [splitPoint(row.file, line, 'L'), splitPoint(row.file, line, 'R')];
    }
    case 'split-pair': {
      const { left, right } = row.row;
      return [
        left && splitPoint(row.file, left.line, 'L'),
        right && splitPoint(row.file, right.line, 'R'),
      ];
    }
    default:
      return [];
  }
}

export function linePoints(
  rows: readonly FlatRow[],
  lines: ReadonlyMap<string, DiffLine[]>
): LinePoints {
  const byFile = new Map<string, LinePoint[]>();
  const rowOf = new Map<string, number>();
  rows.forEach((row, index) => {
    for (const p of pointsOfRow(row, lines)) {
      if (!p) continue;
      const list = byFile.get(p.file) ?? [];
      list.push(p);
      byFile.set(p.file, list);
      rowOf.set(pointKey(p), index);
    }
  });
  return { byFile, rowOf };
}
