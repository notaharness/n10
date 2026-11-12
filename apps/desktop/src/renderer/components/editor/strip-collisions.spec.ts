import type { ClientRect, DroppableContainer } from '@dnd-kit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { showPreview } from './drag-preview.js';
import {
  collisionsEndingAt,
  groupEndId,
  stripEndId,
} from './strip-collisions.js';
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
  it('keeps a keyboard drag in the row it moved to, even when that row ends far left', () => {
    const containers = [
      container('previous-row', 1000, block(1), 200),
      container('next-row', 0, block(2), 200),
    ];
    containers[1]!.rect.current = {
      ...rect(0, 200),
      top: 36,
      bottom: 66,
    };
    const rects = new Map(containers.map((c) => [c.id, c.rect.current!]));
    const collisions = collisionsEndingAt({
      active: { id: 'active', data: { current: undefined } } as never,
      collisionRect: { ...rect(1000, 200), top: 36, bottom: 66 },
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: null,
    });
    expect(collisions[0]?.id).toBe('next-row');
  });

  it('takes the room after the last tab for the last place by index, not by registration', () => {
    // Registered last but shown first: a block that mounted after a drag.
    const containers = [
      container('b1', 50, block(1)),
      container('b2', 100, block(2)),
      container(stripEndId(''), 150, undefined, 500),
      container('b0', 0, block(0)),
    ];
    const rects = new Map(containers.map((c) => [c.id, c.rect.current!]));
    const collisions = collisionsEndingAt({
      active: { id: 'b0', data: { current: undefined } } as never,
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
      container(groupEndId('', 'g'), 100, undefined, 300),
    ];
    containers[2]!.rect.current = { ...rect(0, 100), top: 30, bottom: 60 };
    containers[3]!.rect.current = { ...rect(100, 300), top: 30, bottom: 60 };
    const rects = new Map(containers.map((c) => [c.id, c.rect.current!]));
    const collisions = collisionsEndingAt({
      active: { id: 'm0', data: { current: undefined } } as never,
      collisionRect: { ...rect(300, 100), top: 30, bottom: 60 },
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: { x: 350, y: 45 },
    });
    expect(collisions.map((c) => c.id)).toEqual(['m2']);
  });

  it('takes a pane’s end room for that pane’s last place, not another pane’s', () => {
    const inPane = (pane: string, index: number): StripDragData => ({
      kind: 'block',
      label: '',
      ids: [`${pane}-${index}`],
      index,
      pane,
    });
    // Pane 2 sits below pane 1, and its blocks index further.
    const containers = [
      container('a0', 0, inPane('pane-1', 0)),
      container('a1', 50, inPane('pane-1', 1)),
      container(stripEndId('pane-1'), 100, undefined, 500),
      container('b0', 0, inPane('pane-2', 0)),
      container('b1', 50, inPane('pane-2', 1)),
      container('b2', 100, inPane('pane-2', 2)),
    ];
    for (const c of containers.slice(3))
      c.rect.current = { ...c.rect.current!, top: 300, bottom: 330 };
    const rects = new Map(containers.map((c) => [c.id, c.rect.current!]));
    const collisions = collisionsEndingAt({
      active: { id: 'a0', data: { current: undefined } } as never,
      collisionRect: rect(400, 10),
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: { x: 405, y: 15 },
    });
    expect(collisions.map((c) => c.id)).toEqual(['a1']);
  });

  it('finds the nearest place in the drag’s own pane: another pane’s only under the pointer', () => {
    const inPane = (pane: string, index: number): StripDragData => ({
      kind: 'block',
      label: '',
      ids: [`${pane}-${index}`],
      index,
      pane,
    });
    // Pane 2's block is nearer, but the pointer is over neither.
    const containers = [
      container('a0', 0, inPane('pane-1', 0)),
      container('b0', 400, inPane('pane-2', 0)),
    ];
    const rects = new Map(containers.map((c) => [c.id, c.rect.current!]));
    const collisions = collisionsEndingAt({
      active: { id: 'a1', data: { current: inPane('pane-1', 1) } } as never,
      collisionRect: { ...rect(380, 50), top: 40, bottom: 70 },
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: { x: 405, y: 55 },
    });
    expect(collisions.map((c) => c.id)).toEqual(['a0']);
  });

  describe('a pointer drag carried out of its strip', () => {
    const own: StripDragData = {
      kind: 'block',
      label: '',
      ids: ['t1'],
      index: 1,
      pane: 'pane-1',
    };
    const active = { id: 't1', data: { current: own } } as never;
    const containers = [container('t0', 0, { ...own, ids: ['t0'], index: 0 })];
    const rects = new Map(containers.map((c) => [c.id, c.rect.current!]));
    /** The drag under way started in a strip 600 wide and 30 high. */
    const startedIn = (pointer: { x: number; y: number }) =>
      showPreview({ active, over: null }, rect(0, 600), pointer, () => 'after');
    const at = (pointer: { x: number; y: number }) =>
      collisionsEndingAt({
        active,
        collisionRect: { ...rect(pointer.x, 50), top: pointer.y },
        droppableRects: rects,
        droppableContainers: containers,
        pointerCoordinates: pointer,
      });
    afterEach(() => showPreview(null, null, null, () => 'after'));

    it('is over nothing where nothing legal is under the pointer, so letting go abandons it', () => {
      startedIn({ x: 300, y: 200 });
      expect(at({ x: 300, y: 200 })).toEqual([]);
    });

    it('still finds the nearest place while the pointer is inside the strip', () => {
      startedIn({ x: 300, y: 15 });
      expect(at({ x: 300, y: 15 }).map((c) => c.id)).toEqual(['t0']);
    });
  });
});
