import { describe, expect, it } from 'vitest';
import type { DiffLine } from '@n10/diff';
import { buildFlatDiff } from './diff-virtual.js';
import { linePoints, pointKey } from './diff-points.js';

const lines: DiffLine[] = [
  { type: 'context', content: 'a', oldLine: 1, newLine: 1 },
  { type: 'remove', content: 'b', oldLine: 2 },
  { type: 'add', content: 'c', newLine: 2 },
];

function flat(view: 'unified' | 'split') {
  return buildFlatDiff([['a.ts', lines]], {
    view,
    hideResolved: false,
    hasConversation: false,
    generalThreads: [],
    threadsByFile: new Map(),
    draftsByFile: new Map(),
    fileState: new Map(),
  }).rows;
}

describe('the lines a comment can go on', () => {
  const byName = new Map([['a.ts', lines]]);

  it('in the unified view, one per row, the side the line stands for', () => {
    const { byFile, rowOf } = linePoints(flat('unified'), byName);
    expect(byFile.get('a.ts')).toEqual([
      { file: 'a.ts', side: 'RIGHT', line: 1 },
      { file: 'a.ts', side: 'LEFT', line: 2 },
      { file: 'a.ts', side: 'RIGHT', line: 2 },
    ]);
    expect(rowOf.get(pointKey({ file: 'a.ts', side: 'LEFT', line: 2 }))).toBe(
      2
    );
  });

  it('in the split view, both columns of a row, old side first', () => {
    const { byFile, rowOf } = linePoints(flat('split'), byName);
    const points = byFile.get('a.ts')!;
    expect(points).toEqual([
      { file: 'a.ts', side: 'LEFT', line: 1 },
      { file: 'a.ts', side: 'RIGHT', line: 1 },
      { file: 'a.ts', side: 'LEFT', line: 2 },
      { file: 'a.ts', side: 'RIGHT', line: 2 },
    ]);
    const row = (i: number) => rowOf.get(pointKey(points[i]!));
    expect(row(0)).toBe(row(1));
    expect(row(2)).toBe(row(3));
    expect(row(0)).not.toBe(row(2));
  });
});
