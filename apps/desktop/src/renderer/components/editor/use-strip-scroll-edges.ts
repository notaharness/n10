import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

/** Scroll position and overflow of the strip's one-row track. */
export function useStripScrollEdges(blockKey: string, wrap: boolean) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({
    overflow: false,
    left: false,
    right: false,
  });
  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const next = {
      overflow: el.scrollWidth > el.clientWidth + 1,
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    };
    setEdges((previous) =>
      previous.overflow === next.overflow &&
      previous.left === next.left &&
      previous.right === next.right
        ? previous
        : next
    );
  }, []);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    update();
    return () => observer.disconnect();
  }, [blockKey, wrap, update]);
  return { track, edges, update };
}

/** Keep the active tab (or the chip of the group it is in) in view on
 *  the strip, which scrolls sideways in its one row, or down past its row
 *  cap when wrapped: when it changes, when the blocks around it do
 *  (`blockKey`), and when the strip's room does (a split, a resize). */
export function useActiveTabInView(
  track: RefObject<HTMLDivElement | null>,
  wrap: boolean,
  activeId: string | null,
  blockKey: string
) {
  useEffect(() => {
    const el = track.current;
    if (!el || activeId === null) return;
    const reveal = () => {
      const tab =
        el.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`) ??
        el.querySelector('[data-group-chip][aria-selected=true]');
      if (!tab) return;
      const by = past(tab.getBoundingClientRect(), el.getBoundingClientRect());
      if (wrap && by.y) el.scrollBy({ top: by.y });
      if (!wrap && by.x) el.scrollBy({ left: by.x });
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(el);
    // Label metadata can change a block's width without resizing the track.
    for (const child of el.children) observer.observe(child);
    reveal();
    return () => observer.disconnect();
  }, [track, wrap, activeId, blockKey]);
}

/** How far `row` lies outside `box` on each axis: negative before its
 *  start, positive past its end, 0 inside. */
function past(row: DOMRect, box: DOMRect) {
  const by = (start: number, end: number, from: number, to: number) =>
    Math.min(0, start - from) || Math.max(0, end - to);
  return {
    x: by(row.left, row.right, box.left, box.right),
    y: by(row.top, row.bottom, box.top, box.bottom),
  };
}
