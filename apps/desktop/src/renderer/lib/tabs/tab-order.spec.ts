import { expect, it } from 'vitest';
import { presentationOrder } from './tab-order.js';
import { EMPTY_STRIP, type Strip } from './tabs-model.js';

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
