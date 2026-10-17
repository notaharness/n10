import type { CSSProperties } from 'react';
import type { DiffLine } from '@n10/diff';
import type { FlatRow } from '../../../lib/diff/diff-virtual.js';

const gutters = new WeakMap<DiffLine[], CSSProperties | undefined>();

/**
 * A line-number column wide enough for the file's largest line number.
 * The default fits four digits; a file that runs past 9,999 lines —
 * the large files read by their changes are — widens its own gutter,
 * the same on every row, so the columns still line up.
 */
export function gutterStyle(lines: DiffLine[]): CSSProperties | undefined {
  if (gutters.has(lines)) return gutters.get(lines);
  let max = 0;
  for (const l of lines) max = Math.max(max, l.oldLine ?? 0, l.newLine ?? 0);
  const digits = String(max).length;
  const style =
    digits > 4
      ? ({ '--gutter': `calc(${digits}ch + 0.5rem)` } as CSSProperties)
      : undefined;
  gutters.set(lines, style);
  return style;
}

const CODE_ROWS: ReadonlySet<FlatRow['kind']> = new Set([
  'hunk',
  'fold',
  'unified',
  'split-context',
  'split-pair',
]);

/** The gutter a row takes: its file's code rows, and a comment under a
 *  line, which indents to the code. */
export function rowGutter(
  row: FlatRow,
  linesByFile: ReadonlyMap<string, DiffLine[]>
): CSSProperties | undefined {
  const code =
    CODE_ROWS.has(row.kind) || (row.kind === 'comments' && row.indent);
  if (!code || !('file' in row)) return undefined;
  const lines = linesByFile.get(row.file);
  return lines && gutterStyle(lines);
}
