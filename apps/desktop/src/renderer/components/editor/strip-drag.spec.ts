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
  it('lets a member land in another pane’s strip, beside a block or its own group', () => {
    const tab = { ...member('g', 1), pane: 'pane-1' };
    const there: StripDragData = {
      kind: 'block',
      label: 'b',
      ids: ['c', 'd'],
      index: 0,
      pane: 'pane-2',
    };
    expect(acceptsDrop(there, tab)).toBe(true);
    expect(acceptsDrop({ ...there, pane: 'pane-1' }, tab)).toBe(false);
    expect(acceptsDrop({ ...there, pinned: true } as StripDragData, tab)).toBe(
      false
    );
    expect(acceptsDrop({ ...member('h', 0), pane: 'pane-2' }, tab)).toBe(false);
    expect(dropMove('a', tab, 'block:h', there, [], 'after')).toEqual({
      kind: 'move',
      ids: ['a'],
      targetId: 'd',
      side: 'after',
    });
    // Beside its own group's member there, on the pointer's side.
    expect(
      dropMove(
        'a',
        tab,
        'x',
        { ...member('g', 3), pane: 'pane-2' },
        [],
        'before'
      )
    ).toEqual({ kind: 'move', ids: ['a'], targetId: 'x', side: 'before' });
  });
  it('makes no move onto itself or another group’s member', () => {
    expect(dropMove('a', member('g', 0), 'a', member('g', 0), [])).toBeNull();
    expect(dropMove('a', member('g', 0), 'x', member('h', 0), [])).toBeNull();
  });
});
