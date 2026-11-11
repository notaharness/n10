import { useContext, useSyncExternalStore, type CSSProperties } from 'react';
import type { ClientRect, DragEndEvent, Modifier } from '@dnd-kit/core';
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
} from '@dnd-kit/modifiers';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { usePrefersReducedMotion } from '../../lib/reduced-motion.js';
import { PaneScopeContext } from '../../lib/tabs/tabs.js';
import { dropMove, isStripDragData } from './strip-drag.js';

/**
 * What a tab or group carried out of its strip shows: a copy of it under
 * the pointer (`CarriedBlock`), its own place left standing, faded, in
 * its strip, and, over another pane's strip, the slot it would land in
 * there. Inside its own strip a drag is as it always was: the tab itself
 * moves, held inside the strip (a member inside its group), and its
 * neighbours make way.
 */

interface Point {
  x: number;
  y: number;
}
type Drag = Pick<DragEndEvent, 'active' | 'over'>;

/** Where a cross-pane drop would land: beside the place `id` in
 *  `pane`'s strip, on `side`, as wide as what is carried. */
export interface Landing {
  pane: string;
  id: string;
  side: 'before' | 'after';
  width: number;
}

interface Preview {
  /** The drag is carried outside the strip it came from. */
  out: boolean;
  landing: Landing | null;
}

const NONE: Preview = { out: false, landing: null };
let current: Preview = NONE;
/** The box of the strip the drag under way started in. */
let strip: ClientRect | null = null;
const listeners = new Set<() => void>();

const keyOf = (p: Preview) =>
  p.landing
    ? `${p.out}\n${p.landing.pane}\n${p.landing.id}\n${p.landing.side}\n${p.landing.width}`
    : String(p.out);

function set(next: Preview) {
  if (keyOf(next) === keyOf(current)) return;
  current = next;
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

const inside = (rect: ClientRect, p: Point) =>
  p.x >= rect.left &&
  p.x <= rect.right &&
  p.y >= rect.top &&
  p.y <= rect.bottom;

/** Whether a strip drag with the pointer at `pointer` is out of the
 *  strip it started in. */
function carriedOut(data: unknown, pointer: Point | null): boolean {
  return (
    isStripDragData(data) && !!strip && !!pointer && !inside(strip, pointer)
  );
}

/** Where `drag` would land in another pane's strip, if it is over one:
 *  the side of the place the drop goes (`dropMove`). */
function landingOf(
  { active, over }: Drag,
  side: (rect: ClientRect) => 'before' | 'after'
): Landing | null {
  const dragged = active.data.current;
  const target = over?.data.current;
  if (!over || !isStripDragData(dragged) || !isStripDragData(target))
    return null;
  if (dragged.pane === target.pane) return null;
  const drop = dropMove(
    String(active.id),
    dragged,
    String(over.id),
    target,
    [],
    side(over.rect)
  );
  if (drop?.kind !== 'move') return null;
  return {
    pane: target.pane ?? '',
    id: String(over.id),
    side: drop.side,
    width: active.rect.current.initial?.width ?? 0,
  };
}

/** The drag (or none), the strip it started in, or the pointer
 *  changed: what to show now. */
export function showPreview(
  drag: Drag | null,
  from: ClientRect | null,
  pointer: Point | null,
  side: (rect: ClientRect) => 'before' | 'after'
): void {
  strip = drag ? from : null;
  if (!drag) return set(NONE);
  const out = carriedOut(drag.active.data.current, pointer);
  set({ out, landing: out ? landingOf(drag, side) : null });
}

/** Whether the carried block shows under the pointer, out of its strip. */
export function useCarriedOut(): boolean {
  return useSyncExternalStore(subscribe, () => current.out);
}

/** The slot opened beside place `id` in `pane`'s strip, if any. */
export function useLanding(pane: string, id: string): Landing | null {
  return useSyncExternalStore(subscribe, () =>
    current.landing?.pane === pane && current.landing.id === id
      ? current.landing
      : null
  );
}

/**
 * The strip's modifier: a dragged tab is held inside its strip (past its
 * end it would widen a scrolling box that auto-scroll then chases), a
 * member inside its group, and to its row when the strip scrolls, until
 * it is carried out of the strip, when the copy under the pointer goes
 * where the pointer does. The same rule as `carriedOut`, from the
 * drag's own coordinates.
 */
export const holdInStrip =
  (wrap: boolean): Modifier =>
  (args) => {
    const { active, activatorEvent, transform } = args;
    const start = activatorEvent ? getEventCoordinates(activatorEvent) : null;
    const at = start && { x: start.x + transform.x, y: start.y + transform.y };
    if (carriedOut(active?.data.current, at)) return transform;
    const held = wrap
      ? args
      : { ...args, transform: restrictToHorizontalAxis(args) };
    return restrictToParentElement(held);
  };

/** Room between blocks on the strip (its `gap-2`). */
const GAP_PX = 8;

/**
 * What sortable place `id` adds to its style: a slot opened on the side
 * a cross-pane drop would land, sliding open as the strip's own reorder
 * does, and, for the place a block was carried out of, a faded tab.
 */
export function useSlotStyle(
  id: string
): (dragging: boolean, transition: string | undefined) => CSSProperties {
  const pane = useContext(PaneScopeContext) ?? '';
  const landing = useLanding(pane, id);
  const out = useCarriedOut();
  const still = usePrefersReducedMotion();
  const room = landing ? `${landing.width + GAP_PX}px` : undefined;
  return (dragging, transition) => ({
    marginInlineStart: landing?.side === 'before' ? room : undefined,
    marginInlineEnd: landing?.side === 'after' ? room : undefined,
    opacity: dragging && out ? 0.4 : undefined,
    transition: still
      ? transition
      : [transition, 'margin 200ms ease'].filter(Boolean).join(', '),
  });
}
