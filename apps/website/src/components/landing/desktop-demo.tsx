'use client';

import { MousePointer2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * n10 itself, running in the page on sample data: the desktop
 * renderer built with an in-page mock host (apps/desktop/src/renderer/
 * demo, copied here by `website:sync-demo`). It is laid out at a
 * desktop window's size and scaled to fit. At 1100px and below the demo
 * is hidden, and its sample-data bundle is not loaded.
 *
 * The page tells it by message whether to play (paused off screen), the
 * theme, when the site's changes, and whether it is interactive. It stays
 * inert, out of the tab order and unable to take focus, until the visitor
 * activates the entry button over it; Escape or Ctrl+Space inside it hands
 * focus back to that button. The demo itself holds its running agents once
 * the visitor clicks or types in it, and under reduced motion starts at
 * the end state, so there is no play control.
 */
const SRC = '/desktop-demo/demo/index.html';
const WINDOW = { width: 1280, height: 800 };

const WIDE = '(min-width: 1101px)';

function subscribeWidth(onChange: () => void) {
  const media = window.matchMedia(WIDE);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
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
  const [interactive, setInteractive] = useState(false);
  const entry = useRef<HTMLButtonElement>(null);
  const wide = useSyncExternalStore(
    subscribeWidth,
    () => window.matchMedia(WIDE).matches,
    () => false
  );
  // Narrowing unmounts the frame, and a frame mounted later starts passive.
  const [wasWide, setWasWide] = useState(wide);
  if (wide !== wasWide) {
    setWasWide(wide);
    if (!wide) setInteractive(false);
  }
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scale = useScale(box);
  const inView = useInView(box);
  const { resolvedTheme } = useTheme();
  useEffect(() => send(frame.current, { playing: inView }), [inView]);

  useEffect(() => {
    if (resolvedTheme === 'light' || resolvedTheme === 'dark') {
      send(frame.current, { theme: resolvedTheme });
    }
  }, [resolvedTheme]);

  // The demo posts `n10-demo-exit` when Escape or Ctrl+Space leaves it.
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== 'n10-demo-exit'
      )
        return;
      setInteractive(false);
      send(frame.current, { interactive: false });
      requestAnimationFrame(() =>
        entry.current?.focus({ preventScroll: true })
      );
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  function enter() {
    setInteractive(true);
    // The frame becomes non-inert before its own focus request is delivered.
    requestAnimationFrame(() => send(frame.current, { interactive: true }));
  }

  return (
    <div id="desktop-demo" className={cn('relative scroll-mt-24', className)}>
      {/* The heading has tabIndex={-1} (purpose-sections.tsx), so it can
          take focus as well as the scroll. */}
      <a
        className="skip-link"
        href="#coding-heading"
        onClick={() => document.getElementById('coding-heading')?.focus()}
      >
        Skip demo
      </a>
      <div className="demo-viewport">
        {!interactive && (
          <button
            ref={entry}
            type="button"
            className="demo-entry"
            aria-label="Use n10 demo. Escape returns to the page."
            onClick={enter}
          >
            <MousePointer2 size={24} aria-hidden />
          </button>
        )}
        <div
          ref={box}
          inert={!interactive}
          className="n10-frame bg-fd-card relative w-full overflow-hidden rounded-sm"
          style={{ aspectRatio: `${WINDOW.width} / ${WINDOW.height}` }}
        >
          {wide && (
            <iframe
              ref={frame}
              src={SRC}
              title="n10, running on sample data"
              tabIndex={-1}
              onLoad={(event) =>
                send(event.currentTarget, {
                  playing: inView,
                  theme: resolvedTheme,
                })
              }
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
    </div>
  );
}
