import { useDndContext } from '@dnd-kit/core';
import { useEffect, type RefObject } from 'react';

/** Pointer motion in the track's 24px edge bands advances a drag at
 *  360px/s. The loop stops as soon as the pointer leaves or the drag ends. */
export function useEdgeAutoScroll(
  track: RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  const dragging = useDndContext().active !== null;
  useEffect(() => {
    if (!enabled || !dragging) return;
    let speed = 0;
    let frame = 0;
    let last = 0;
    const move = (event: PointerEvent) => {
      const el = track.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      speed =
        event.clientY < rect.top || event.clientY > rect.bottom
          ? 0
          : event.clientX < rect.left + 24 && event.clientX >= rect.left
          ? -360
          : event.clientX > rect.right - 24 && event.clientX <= rect.right
          ? 360
          : 0;
    };
    const tick = (time: number) => {
      if (speed && last)
        track.current?.scrollBy({ left: (speed * (time - last)) / 1000 });
      last = time;
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', move);
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', move);
      cancelAnimationFrame(frame);
    };
  }, [dragging, enabled, track]);
}
