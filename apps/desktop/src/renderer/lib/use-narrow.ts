import { useLayoutEffect, useState, type RefObject } from 'react';

/** Whether an element is narrower than `below` pixels, as it resizes.
 *  The first width is measured before the first paint, so a narrow
 *  element never paints as a wide one. */
export function useNarrow(
  ref: RefObject<HTMLElement | null>,
  below: number
): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setNarrow(el.clientWidth < below);
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < below));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, below]);
  return narrow;
}
