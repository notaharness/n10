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

/** Wrapped, the strip scrolls past its row cap: keep the active tab (or
 *  its collapsed group's home) in view when it changes, when the blocks
 *  around it do (`blockKey`), and when the strip's room does (a split, a
 *  resize). */
export function useActiveTabInView(
  track: RefObject<HTMLDivElement | null>,
  wrap: boolean,
  activeId: string | null,
  blockKey: string
) {
  useEffect(() => {
    const el = track.current;
    if (!wrap || !el || activeId === null) return;
    const reveal = () => {
      const key = CSS.escape(activeId);
      const tab = el.querySelector(
        `[data-tab-id="${key}"], [data-home-tab="${key}"]`
      );
      if (!tab) return;
      const row = tab.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const above = Math.min(0, row.top - box.top);
      const below = Math.max(0, row.bottom - box.bottom);
      if (above || below) el.scrollBy({ top: above || below });
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(el);
    reveal();
    return () => observer.disconnect();
  }, [track, wrap, activeId, blockKey]);
}
