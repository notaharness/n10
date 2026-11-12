import { useCallback, useEffect, useRef, useState } from 'react';

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
