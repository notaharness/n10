import { expect, it } from 'vitest';
import { presentationOrder } from './tab-order.js';
import { EMPTY_STRIP, reduce, type Strip } from './tabs-model.js';
import { EMPTY_WORKSPACE, stripOf } from './workspace.js';

it('retains open order and prunes closed tab collision allocations', () => {
  const a = {
    id: 'a',
    kind: 'item',
    repo: '/a',
    itemKey: 'branch:a',
    preview: false,
  } as const;
  const b = {
    id: 'b',
    kind: 'item',
    repo: '/a',
    itemKey: 'branch:b',
    preview: false,
  } as const;
  const previous: Strip = {
    ...EMPTY_STRIP,
    tabs: [a, b],
    openedIds: ['b', 'a'],
    collisionOrdinals: {
      a: { base: 'forge', ordinal: 2 },
      b: { base: 'forge', ordinal: 1 },
    },
  };
  const next = presentationOrder(previous, { ...previous, tabs: [a] });
  expect(next.openedIds).toEqual(['a']);
  expect(next.collisionOrdinals).toEqual({ a: { base: 'forge', ordinal: 2 } });
});

it('keeps collision and chip ordinals separate for each pane', () => {
  const workspace = {
    ...EMPTY_WORKSPACE,
    tabs: {
      a: {
        id: 'a',
        kind: 'item' as const,
        repo: '/a',
        itemKey: 'branch:a',
        preview: false as const,
      },
      b: {
        id: 'b',
        kind: 'item' as const,
        repo: '/b',
        itemKey: 'branch:b',
        preview: false as const,
      },
    },
    layout: {
      kind: 'split' as const,
      id: 'split-1',
      direction: 'row' as const,
      children: [
        { kind: 'pane' as const, id: 'left', order: ['a'], activeId: 'a' },
        { kind: 'pane' as const, id: 'right', order: ['b'], activeId: 'b' },
      ],
      sizes: [0.5, 0.5],
    },
    labelState: {
      left: {
        openedIds: ['a'],
        collisionOrdinals: { a: { base: 'Fix auth', ordinal: 1 } },
        chipOrdinals: { claude: { label: 'Claude · n10', ordinal: 1 } },
      },
      right: {
        openedIds: ['b'],
        collisionOrdinals: { b: { base: 'Fix auth', ordinal: 2 } },
        chipOrdinals: { claude: { label: 'Claude · n10', ordinal: 2 } },
      },
    },
  };
  expect(stripOf(workspace, 'left').chipOrdinals?.claude?.ordinal).toBe(1);
  expect(stripOf(workspace, 'right').chipOrdinals?.claude?.ordinal).toBe(2);
  expect(stripOf(workspace, 'left').collisionOrdinals).not.toHaveProperty('b');
  const changed = reduce(workspace, {
    type: 'assign-chip-ordinals',
    scope: 'left',
    values: { claude: { label: 'Claude · n10', ordinal: 3 } },
  });
  expect(stripOf(changed, 'left').chipOrdinals?.claude?.ordinal).toBe(3);
  expect(stripOf(changed, 'right').chipOrdinals?.claude?.ordinal).toBe(2);
});
