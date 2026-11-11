import { useDndContext, useDndMonitor } from '@dnd-kit/core';
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

/** A roster's open state, for `Popover`'s controlled `open`. */
export function useRosterOpen() {
  const [mode, setMode] = useState<RosterMode | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Escape keeps hover from opening it again until the pointer leaves.
  const suppressed = useRef(false);
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
  // A drag is no rest: a pending open is dropped, and a hover-open
  // roster closes.
  useDndMonitor({
    onDragStart() {
      clear();
      setMode((now) => (now === 'hover' ? null : now));
    },
  });

  return {
    mode,
    open: mode !== null,
    /** The pointer came onto the chip or the roster. */
    enter() {
      clear();
      if (mode !== null || dragging || suppressed.current) return;
      timer.current = setTimeout(() => setMode('hover'), HOVER_OPEN_MS);
    },
    /** The pointer left the chip or the roster. */
    leave() {
      clear();
      suppressed.current = false;
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
    escaped() {
      suppressed.current = true;
      close();
    },
    close,
  };
}
