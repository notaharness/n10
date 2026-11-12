import { useDndContext, useDndMonitor, type Active } from '@dnd-kit/core';
import { isStripDragData } from './strip-drag.js';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Resting on a chip this long opens its roster. */
export const HOVER_OPEN_MS = 400;
/** Leaving the chip and the roster for this long closes a roster hover
 *  opened; the gap between them is crossed well within it. */
export const HOVER_CLOSE_MS = 180;

/**
 * How a roster is open: `hover` (the pointer rests on the chip; it
 * closes when the pointer leaves), `pinned` (held open while a row's
 * menu is up; it closes on a choice, Escape or a press outside) or
 * `keyboard` (as pinned, with its rows focused).
 */
export type RosterMode = 'hover' | 'pinned' | 'keyboard';

/** The roster a drag's row is in, if it drags a row. */
const rowOf = (active: Active | null | undefined): string | undefined => {
  const data = active?.data.current;
  return isStripDragData(data) ? data.row : undefined;
};

/** A roster's open state, for `Popover`'s controlled `open`. `group`:
 *  the group it lists, whose rows' drags hold it open. */
export function useRosterOpen(group?: string) {
  const [mode, setMode] = useState<RosterMode | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // How it was open when one of its rows was picked up: a row landing
  // back in it, or put back with Escape, leaves it open that way again.
  const before = useRef<RosterMode | null>(null);
  const dragging = useDndContext().active !== null;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const close = useCallback(() => {
    clear();
    setMode(null);
  }, []);
  const own = (active: Active) =>
    group !== undefined && rowOf(active) === group;
  const putBack = () => setMode(before.current ?? 'pinned');
  // A drag is no rest: a pending open is dropped, and a hover-open
  // roster closes, unless the drag is one of its own rows, which holds
  // it open until the row is dropped back in it or carried away.
  useDndMonitor({
    onDragStart({ active }) {
      clear();
      if (own(active)) before.current = mode;
      setMode((now) => (own(active) ? 'pinned' : now === 'hover' ? null : now));
    },
    onDragEnd({ active, over }) {
      if (!own(active)) return;
      const data = over?.data.current;
      if (isStripDragData(data) && data.row === group) putBack();
      else close();
    },
    onDragCancel({ active }) {
      if (own(active)) putBack();
    },
  });

  return {
    mode,
    open: mode !== null,
    /** The pointer came onto the chip or the roster. Only coming onto
     *  it opens it: a pointer still resting where Escape closed it does
     *  not open it again. */
    enter() {
      clear();
      if (mode !== null || dragging) return;
      timer.current = setTimeout(() => setMode('hover'), HOVER_OPEN_MS);
    },
    /** The pointer left the chip or the roster. */
    leave() {
      clear();
      if (mode === 'hover') timer.current = setTimeout(close, HOVER_CLOSE_MS);
    },
    /** A press anywhere on the chip: the pointer is not resting, so a
     *  pending hover-open is dropped. */
    cancelHover() {
      if (mode === null) clear();
    },
    /** Keep a hover-open roster open, as a press would (its row's menu
     *  takes the pointer away). */
    hold() {
      clear();
      setMode((now) => (now === 'hover' ? 'pinned' : now));
    },
    openByKeyboard() {
      clear();
      setMode('keyboard');
    },
    close,
  };
}
