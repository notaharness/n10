import { useEffect, useState, type RefObject } from 'react';

/** Whether an element is narrower than `below` pixels, as it resizes.
 *  The observer reports the first size itself, before the next paint. */
export function useNarrow(
  ref: RefObject<HTMLElement | null>,
  below: number
): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < below));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, below]);
  return narrow;
}
