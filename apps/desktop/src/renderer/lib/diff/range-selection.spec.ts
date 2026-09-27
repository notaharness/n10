import { describe, expect, it } from 'vitest';
import type { DiffLine } from '@n10/diff';
import {
  extend,
  isSelected,
  neighbour,
  rangeSource,
  rangeWords,
  select,
  selectionRange,
  splitPoint,
  unifiedPoint,
  type LinePoint,
} from './range-selection.js';

const F = 'src/request.ts';
const ctx = (o: number, n: number, content = `ctx ${n}`): DiffLine => ({
  type: 'context',
  content,
  oldLine: o,
  newLine: n,
});
const add = (n: number, content = `add ${n}`): DiffLine => ({
  type: 'add',
  content,
  newLine: n,
});
const del = (o: number, content = `del ${o}`): DiffLine => ({
  type: 'remove',
  content,
  oldLine: o,
});
const R = (line: number): LinePoint => ({ file: F, side: 'RIGHT', line });
const L = (line: number): LinePoint => ({ file: F, side: 'LEFT', line });

describe('the side a line stands for', () => {
  it('is fixed by the line in the unified view: removed LEFT, the rest RIGHT', () => {
    expect(unifiedPoint(F, del(18))).toEqual(L(18));
    expect(unifiedPoint(F, add(41))).toEqual(R(41));
    expect(unifiedPoint(F, ctx(40, 42))).toEqual(R(42));
    expect(unifiedPoint(F, { type: 'hunk-header', content: '@@' })).toBeNull();
  });

  it('is the column in the split view, so a context line has both', () => {
    expect(splitPoint(F, ctx(40, 42), 'L')).toEqual(L(40));
    expect(splitPoint(F, ctx(40, 42), 'R')).toEqual(R(42));
    expect(splitPoint(F, add(41), 'L')).toBeNull();
  });
});

describe('selecting a range', () => {
  it('extends down or up on one side, and reads as a sorted range', () => {
    const sel = extend(select(R(43)), R(41));
    expect(selectionRange(sel)).toEqual({
      startSide: 'RIGHT',
      start: 41,
      side: 'RIGHT',
      end: 43,
    });
    expect(isSelected(sel, R(42))).toBe(true);
    expect(isSelected(sel, L(42))).toBe(false);
  });

  it('starts again rather than span two sides or two files', () => {
    expect(extend(select(R(41)), L(18))).toEqual(select(L(18)));
    const other = { ...R(41), file: 'other.ts' };
    expect(extend(select(R(41)), other)).toEqual(select(other));
  });
});

describe('moving through the lines on screen', () => {
  const points = [R(40), L(18), L(19), R(41), R(42)];

  it('steps to the next line, whatever its side', () => {
    expect(neighbour(points, R(40), 1, false)).toEqual(L(18));
    expect(neighbour(points, R(40), -1, false)).toBeNull();
  });

  it('keeps to one side when extending', () => {
    expect(neighbour(points, R(40), 1, true)).toEqual(R(41));
    expect(neighbour(points, L(19), 1, true)).toBeNull();
  });
});

describe('the code a range was written on', () => {
  const lines = [
    ctx(17, 17),
    del(18, 'old a'),
    del(19, 'old b'),
    add(18, 'new a'),
    ctx(20, 19),
  ];

  it('keeps each side’s own lines', () => {
    expect(
      rangeSource(lines, {
        startSide: 'LEFT',
        start: 18,
        side: 'LEFT',
        end: 20,
      })
    ).toEqual(['old a', 'old b', 'ctx 19']);
    expect(
      rangeSource(lines, {
        startSide: 'RIGHT',
        start: 18,
        side: 'RIGHT',
        end: 19,
      })
    ).toEqual(['new a', 'ctx 19']);
  });

  it('names the place in words', () => {
    expect(
      rangeWords({ startSide: 'RIGHT', start: 41, side: 'RIGHT', end: 43 })
    ).toBe('new lines 41–43');
    expect(
      rangeWords({ startSide: 'LEFT', start: 18, side: 'LEFT', end: 18 })
    ).toBe('old line 18');
  });
});
