import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from '@dnd-kit/core';
import { isStripDragData } from './strip-drag.js';
import { isPaneZone } from './use-pane-drop.js';

const END_PREFIX = 'tab-strip-end:';

/** The room after a pane's last tab: over it, a drag is over the last
 *  place it may land in that pane. */
export function stripEndId(pane: string): string {
  return `${END_PREFIX}${pane}`;
}

/** The room after a wrapped group's last tab in `pane`, which is its
 *  members' end as `stripEndId` is the strip's. */
export function groupEndId(pane: string, key: string): string {
  return `${END_PREFIX}${pane}:${key}`;
}

const isEnd = (id: unknown) => String(id).startsWith(END_PREFIX);

/** The pane an end room belongs to: pane ids hold no colon. */
const endPane = (id: unknown) =>
  String(id).slice(END_PREFIX.length).split(':')[0];

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

/** A place's pane and index on the strip, as its data says
 *  (`StripDragData`). */
function placeOf(container: { data: { current?: unknown } }) {
  const data = container.data.current;
  return isStripDragData(data)
    ? { pane: data.pane ?? '', index: data.index }
    : { pane: '', index: -1 };
}

/**
 * What the pointer is over, or, where it is over no legal place (a
 * keyboard drag, a border, another group), the legal place nearest the
 * dragged one. Keyboard drags choose the nearest row before a place in
 * it, so a row ending far left cannot lose to a tab on the old row.
 * A member dragged out of its group opens the slot at that end of its
 * group. Only legal places are enabled droppables (`strip-drag.ts`), so
 * nothing else is ever a candidate. The room after the last tab, a pane
 * strip's or a wrapped group's, counts as the last legal place in that
 * pane by index, not by when it registered: dnd-kit lists containers in
 * mount order. Over a pane's content the pane itself is the target
 * (`use-pane-drop.ts`); it is never the nearest place to anything.
 */
export const collisionsEndingAt: CollisionDetection = (args) => {
  const places = args.droppableContainers.filter(
    (c) => !isEnd(c.id) && !isPaneZone(c.id)
  );
  const within = pointerWithin(args);
  const end = within.find((c) => isEnd(c.id));
  if (end) {
    const pane = endPane(end.id);
    const last = places
      .filter((c) => placeOf(c).pane === pane)
      .reduce<(typeof places)[number] | undefined>(
        (best, c) =>
          !best || placeOf(c).index > placeOf(best).index ? c : best,
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
