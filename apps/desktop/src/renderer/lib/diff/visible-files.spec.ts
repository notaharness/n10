import { describe, expect, it } from 'vitest';
import type { FlatRow } from './diff-rows-model.js';
import { visibleFiles } from './visible-files.js';

const rows: FlatRow[] = [
  { key: 'conversation', kind: 'conversation' },
  { key: 'a-header', kind: 'file-header', file: 'a.ts' },
  { key: 'a-code', kind: 'unified', file: 'a.ts', index: 0 },
  { key: 'b-header', kind: 'file-header', file: 'b.ts' },
  { key: 'b-notice', kind: 'file-notice', file: 'b.ts', estimate: 1000 },
  { key: 'c-header', kind: 'file-header', file: 'c.ts' },
];
const items = [
  { index: 0, start: 0, end: 100 },
  { index: 1, start: 100, end: 137 },
  { index: 2, start: 137, end: 157 },
  { index: 3, start: 157, end: 194 },
  { index: 4, start: 194, end: 1194 },
  { index: 5, start: 1194, end: 1231 },
];

describe('visible diff files', () => {
  it('highlights both files at a boundary, excluding overscanned files', () => {
    expect([...visibleFiles(rows, items, 140, 40)]).toEqual(['a.ts', 'b.ts']);
  });
  it('excludes rows that only touch the viewport edges', () => {
    expect([...visibleFiles(rows, items, 157, 37)]).toEqual(['b.ts']);
  });
  it('keeps a file visible when its header has scrolled away', () => {
    expect([...visibleFiles(rows, items, 500, 200)]).toEqual(['b.ts']);
  });
  it('counts collapsed file headers', () => {
    expect([...visibleFiles(rows, items, 1200, 20)]).toEqual(['c.ts']);
  });
  it('does not associate the conversation or an empty viewport with a file', () => {
    expect([...visibleFiles(rows, items, 0, 100)]).toEqual([]);
    expect([...visibleFiles(rows, items, 200, 0)]).toEqual([]);
    expect([...visibleFiles([], [], 0, 100)]).toEqual([]);
  });
  it('updates the set after scrolling and resizing', () => {
    expect([...visibleFiles(rows, items, 140, 10)]).toEqual(['a.ts']);
    expect([...visibleFiles(rows, items, 140, 100)]).toEqual(['a.ts', 'b.ts']);
    expect([...visibleFiles(rows, items, 160, 100)]).toEqual(['b.ts']);
  });
});
