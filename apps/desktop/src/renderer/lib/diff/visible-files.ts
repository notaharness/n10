import type { FlatRow } from './diff-rows-model.js';

/** Actual viewport intersection, excluding the virtualizer's overscan. */
export function visibleFiles(
  rows: readonly FlatRow[],
  items: readonly { index: number; start: number; end: number }[],
  offset: number,
  height: number
): ReadonlySet<string> {
  const files = new Set<string>();
  if (height <= 0) return files;
  for (const item of items) {
    if (item.end <= offset || item.start >= offset + height) continue;
    const row = rows[item.index];
    if (row && 'file' in row) files.add(row.file);
  }
  return files;
}
