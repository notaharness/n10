import { describe, expect, it } from 'vitest';
import { acceptsDrop, dropMove, type StripDragData } from './strip-drag.js';

const block = (ids: string[], index: number): StripDragData => ({
  kind: 'block',
  label: 'b',
  ids,
  index,
});

describe('strip drag', () => {
  it('lets a block land between blocks', () => {
    expect(acceptsDrop(block(['x'], 1), block(['a', 'b'], 0))).toBe(true);
  });
  it('keeps pinned tabs among the pinned, and everything else out of them', () => {
    const pin = (id: string, index: number): StripDragData =>
      ({
        ...block([id], index),
        pinned: true,
      } as StripDragData);
    expect(acceptsDrop(pin('p', 0), pin('q', 1))).toBe(true);
    expect(acceptsDrop(block(['x'], 2), pin('q', 1))).toBe(false);
    expect(acceptsDrop(pin('p', 0), block(['x'], 2))).toBe(false);
  });
  it('arranges the strip as presented, with the block in its new place', () => {
    const blocks = [['a', 'b'], ['c'], ['d', 'e']];
    expect(
      dropMove(
        'block:g',
        block(['a', 'b'], 0),
        'block:x',
        block(['d', 'e'], 2),
        blocks
      )
    ).toEqual({ kind: 'arrange', ids: ['c', 'd', 'e', 'a', 'b'] });
    expect(
      dropMove(
        'block:x',
        block(['d', 'e'], 2),
        'block:c',
        block(['c'], 1),
        blocks
      )
    ).toEqual({ kind: 'arrange', ids: ['a', 'b', 'd', 'e', 'c'] });
  });
  it('makes no move from a strip that changed under the drag', () => {
    expect(
      dropMove('block:g', block(['a'], 0), 'block:c', block(['c'], 1), [
        ['a', 'b'],
        ['c'],
      ])
    ).toBeNull();
  });
  it('moves a block onto another pane’s block beside it there', () => {
    const left = { ...block(['a', 'b'], 0), pane: 'pane-1' };
    const right = { ...block(['c', 'd'], 2), pane: 'pane-2' };
    // On the side of it the pointer is on, whatever either index.
    expect(
      dropMove('block:g', left, 'block:h', right, [['a', 'b']], 'after')
    ).toEqual({ kind: 'move', ids: ['a', 'b'], targetId: 'd', side: 'after' });
    expect(
      dropMove('block:g', left, 'block:h', right, [['a', 'b']], 'before')
    ).toEqual({
      kind: 'move',
      ids: ['a', 'b'],
      targetId: 'c',
      side: 'before',
    });
  });
  it('makes no move onto itself', () => {
    const blocks = [['a'], ['b']];
    expect(
      dropMove('block:a', block(['a'], 0), 'block:a', block(['a'], 0), blocks)
    ).toBeNull();
  });
});
