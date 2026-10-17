import { useEffect, useState } from 'react';

/** How long the scroll must rest with the element near before it counts:
 *  the virtualizer's own `isScrolling` reset, which holds batch reads. */
const SETTLE_MS = 150;

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
 *
 * It counts only once the scroll settles with the element near, as the
 * diff's batch reads do: a drag through the list would otherwise start
 * a read for everything it passes.
 */
export function useInView<T extends Element>(
  margin = '200px'
): [(el: T | null) => void, boolean] {
  const [seen, setSeen] = useState(false);
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    if (seen || !el) return;
    const root = scrollRoot(el);
    const scroller = root ?? window;
    let near = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Every scroll while near starts the wait again.
    const settle = () => {
      clearTimeout(timer);
      timer = near ? setTimeout(() => setSeen(true), SETTLE_MS) : undefined;
    };
    const io = new IntersectionObserver(
      (entries) => {
        near = entries[entries.length - 1]?.isIntersecting ?? false;
        settle();
      },
      { root, rootMargin: margin }
    );
    io.observe(el);
    scroller.addEventListener('scroll', settle, { passive: true });
    return () => {
      io.disconnect();
      scroller.removeEventListener('scroll', settle);
      clearTimeout(timer);
    };
  }, [el, seen, margin]);
  return [setEl, seen];
}
