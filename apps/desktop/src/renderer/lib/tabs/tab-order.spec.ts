import { expect, it } from 'vitest';
import { presentationOrder } from './tab-order.js';
import { EMPTY_STRIP, type Strip } from './tabs-model.js';
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
    layout: {
      kind: 'split' as const,
      direction: 'row' as const,
      children: [
        { kind: 'pane' as const, id: 'left', order: [], activeId: null },
        { kind: 'pane' as const, id: 'right', order: [], activeId: null },
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
});
