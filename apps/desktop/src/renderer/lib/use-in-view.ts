import { useEffect, useState } from 'react';

/** The nearest ancestor that scrolls, or null for the viewport. */
function scrollRoot(el: Element): Element | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (/^(auto|scroll|overlay)$/.test(overflowY)) return at;
  }
  return null;
}

/**
 * Whether an element has come near the screen, latched: once it has, it
 * stays true, so what it started loading is kept. `margin` reaches past
 * the edge of the element's scroll container, so a read starts a little
 * before the element scrolls in. Against the viewport the margin would
 * be lost: the container clips the element before it gets there.
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
      { root: scrollRoot(el), rootMargin: margin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen, margin]);
  return [setEl, seen];
}
