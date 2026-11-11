import { describe, expect, it } from 'vitest';
import { acceptsDrop, dropMove, type StripDragData } from './strip-drag.js';

const member = (group: string, index: number): StripDragData => ({
  kind: 'member',
  label: 'm',
  group,
  index,
});
const block = (ids: string[], index: number): StripDragData => ({
  kind: 'block',
  label: 'b',
  ids,
  index,
});

describe('strip drag', () => {
  it('lets a member land only among its own group’s members', () => {
    expect(acceptsDrop(member('g', 1), member('g', 0))).toBe(true);
    expect(acceptsDrop(member('h', 1), member('g', 0))).toBe(false);
    expect(acceptsDrop(block(['x'], 1), member('g', 0))).toBe(false);
  });
  it('lets a block land only between blocks', () => {
    expect(acceptsDrop(block(['x'], 1), block(['a', 'b'], 0))).toBe(true);
    expect(acceptsDrop(member('g', 0), block(['a', 'b'], 0))).toBe(false);
  });
  it('moves a member before or after its target by their places', () => {
    expect(dropMove('a', member('g', 0), 'c', member('g', 2), [])).toEqual({
      kind: 'move',
      ids: ['a'],
      targetId: 'c',
      side: 'after',
    });
    expect(dropMove('c', member('g', 2), 'a', member('g', 0), [])).toEqual({
      kind: 'move',
      ids: ['c'],
      targetId: 'a',
      side: 'before',
    });
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
  it('makes no move onto itself or another group’s member', () => {
    expect(dropMove('a', member('g', 0), 'a', member('g', 0), [])).toBeNull();
    expect(dropMove('a', member('g', 0), 'x', member('h', 0), [])).toBeNull();
  });
});
