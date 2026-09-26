'use client';

import { MousePointerClick } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/cn';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';

/**
 * n10 Desktop itself, running in the page on sample data: the desktop
 * renderer built with an in-page mock host (apps/desktop/src/renderer/
 * demo, copied here by `website:sync-demo`). It is laid out at a
 * desktop window's size and scaled to fit. The frame is only created
 * from `WIDE` up, where the scaled app is still readable; below it the
 * hero shows a screenshot and the demo costs nothing.
 *
 * The page tells it two things by message: whether to play (paused off
 * screen) and the theme, when the site's changes. The demo itself holds
 * its running agents once the visitor clicks or types in it, and under
 * reduced motion starts at the end state, so there is no play control.
 */
const SRC = '/desktop-demo/demo/index.html';
const WINDOW = { width: 1280, height: 800 };
/** Tailwind's `lg`, which the hero uses to swap the screenshot out. */
const WIDE = '(min-width: 64rem)';

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

function send(frame: HTMLIFrameElement | null, message: object): void {
  frame?.contentWindow?.postMessage(
    { type: 'n10-demo', ...message },
    window.location.origin
  );
}

function useScale(ref: RefObject<HTMLElement | null>): number {
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setScale((entry?.contentRect.width ?? 0) / WINDOW.width)
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return scale;
}

function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry?.isIntersecting ?? false)
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

export function DesktopDemo({ className }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scale = useScale(box);
  const inView = useInView(box);
  const { resolvedTheme } = useTheme();
  const wide = useMedia(WIDE);
  useEffect(() => send(frame.current, { playing: inView }), [inView]);

  useEffect(() => {
    if (resolvedTheme === 'light' || resolvedTheme === 'dark') {
      send(frame.current, { theme: resolvedTheme });
    }
  }, [resolvedTheme]);

  return (
    <div className={cn('relative', className)}>
      <p className="border-fd-border bg-fd-card text-fd-muted-foreground absolute -top-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap">
        <MousePointerClick className="size-3.5" aria-hidden />
        Try a preview
        <span className="text-fd-muted-foreground text-[11px] font-normal">
          · sample data
        </span>
      </p>
      <div
        ref={box}
        className="n10-frame bg-fd-card relative w-full overflow-hidden rounded-xl"
        style={{ aspectRatio: `${WINDOW.width} / ${WINDOW.height}` }}
      >
        {wide && (
          <iframe
            ref={frame}
            src={SRC}
            title="n10 Desktop, running on sample data"
            onLoad={(event) => send(event.currentTarget, { playing: inView })}
            className="absolute top-0 left-0 origin-top-left border-0"
            style={{
              width: WINDOW.width,
              height: WINDOW.height,
              transform: `scale(${scale})`,
              visibility: scale ? 'visible' : 'hidden',
            }}
          />
        )}
      </div>
    </div>
  );
}
