import { useEffect, useState } from 'react';

/**
 * Whether an element has come near the screen, latched: once it has, it
 * stays true, so what it started loading is kept. `margin` reaches past
 * the edge, so a read starts a little before the element scrolls in.
 */
export function useInView<T extends Element>(
  margin = '200px'
): [(el: T | null) => void, boolean] {
  const [seen, setSeen] = useState(false);
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { rootMargin: margin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen, margin]);
  return [setEl, seen];
}
