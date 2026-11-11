import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from '@dnd-kit/core';
import { isStripDragData } from './strip-drag.js';

/** The room after the last tab: over it, a drag is over the last place
 *  it may land. */
export const END_ID = 'tab-strip-end';

/** The room after a wrapped group's last tab, which is its members'
 *  end as `END_ID` is the strip's. */
export function groupEndId(key: string): string {
  return `${END_ID}:${key}`;
}

const isEnd = (id: unknown) =>
  id === END_ID || String(id).startsWith(`${END_ID}:`);

/** Keyboard coordinates name a row first. A far-left tab on the next
 * row must beat a horizontally nearby tab on the old row. */
function keyboardRow(
  args: Parameters<CollisionDetection>[0],
  places: typeof args.droppableContainers
) {
  const distance = (id: (typeof places)[number]['id']) => {
    const rect = args.droppableRects.get(id);
    return rect ? Math.abs(rect.top - args.collisionRect.top) : Infinity;
  };
  const nearest = Math.min(...places.map((place) => distance(place.id)));
  return places.filter((place) => distance(place.id) <= nearest + 1);
}

/** A place's index on the strip, as its data says (`StripDragData`). */
function indexOf(container: { data: { current?: unknown } }): number {
  const data = container.data.current;
  return isStripDragData(data) ? data.index : -1;
}

/**
 * What the pointer is over, or, where it is over no legal place (a
 * keyboard drag, a border, another group), the legal place nearest the
 * dragged one. Keyboard drags choose the nearest row before a place in
 * it, so a row ending far left cannot lose to a tab on the old row.
 * A member dragged out of its group opens the slot at that
 * end of its group. Only legal places are enabled droppables
 * (`strip-drag.ts`), so nothing else is ever a candidate. The room after
 * the last tab, the strip's or a wrapped group's, counts as the last
 * legal place by index, not by when it registered: dnd-kit lists
 * containers in mount order.
 */
export const collisionsEndingAt: CollisionDetection = (args) => {
  const places = args.droppableContainers.filter((c) => !isEnd(c.id));
  const within = pointerWithin(args);
  if (within.some((c) => isEnd(c.id))) {
    const last = places.reduce<(typeof places)[number] | undefined>(
      (best, c) => (!best || indexOf(c) > indexOf(best) ? c : best),
      undefined
    );
    return last ? [{ id: last.id }] : [];
  }
  if (within.length > 0) return within;
  return closestCenter({
    ...args,
    droppableContainers:
      args.pointerCoordinates === null ? keyboardRow(args, places) : places,
  });
};
