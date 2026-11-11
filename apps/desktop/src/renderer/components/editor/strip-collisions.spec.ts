import type { ClientRect, DroppableContainer } from '@dnd-kit/core';
import { describe, expect, it } from 'vitest';
import { collisionsEndingAt, END_ID, groupEndId } from './strip-collisions.js';
import type { StripDragData } from './strip-drag.js';

const rect = (left: number, width = 50): ClientRect => ({
  left,
  top: 0,
  width,
  height: 30,
  right: left + width,
  bottom: 30,
});

const container = (
  id: string,
  left: number,
  data?: StripDragData,
  width?: number
): DroppableContainer =>
  ({
    id,
    key: id,
    data: { current: data },
    disabled: false,
    node: { current: null },
    rect: { current: rect(left, width) },
  } as DroppableContainer);

const block = (index: number): StripDragData => ({
  kind: 'block',
  label: '',
  ids: [`t${index}`],
  index,
});

describe('collisionsEndingAt', () => {
  it('takes the room after the last tab for the last place by index, not by registration', () => {
    // Registered last but shown first: a block that mounted after a drag.
    const containers = [
      container('b1', 50, block(1)),
      container('b2', 100, block(2)),
      container(END_ID, 150, undefined, 500),
      container('b0', 0, block(0)),
    ];
    const rects = new Map(containers.map((c) => [c.id, c.rect.current!]));
    const collisions = collisionsEndingAt({
      active: { id: 'b0' } as never,
      collisionRect: rect(400, 10),
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: { x: 405, y: 15 },
    });
    expect(collisions.map((c) => c.id)).toEqual(['b2']);
  });

  it('takes a wrapped group’s end room for its last member', () => {
    const member = (index: number): StripDragData => ({
      kind: 'member',
      label: '',
      group: 'g',
      index,
    });
    // Two rows: members 0 and 1 above, 2 below; the end room beside it.
    const containers = [
      container('m0', 0, member(0), 200),
      container('m1', 200, member(1), 200),
      container('m2', 0, member(2), 100),
      container(groupEndId('g'), 100, undefined, 300),
    ];
    containers[2]!.rect.current = { ...rect(0, 100), top: 30, bottom: 60 };
    containers[3]!.rect.current = { ...rect(100, 300), top: 30, bottom: 60 };
    const rects = new Map(containers.map((c) => [c.id, c.rect.current!]));
    const collisions = collisionsEndingAt({
      active: { id: 'm0' } as never,
      collisionRect: { ...rect(300, 100), top: 30, bottom: 60 },
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: { x: 350, y: 45 },
    });
    expect(collisions.map((c) => c.id)).toEqual(['m2']);
  });
});
