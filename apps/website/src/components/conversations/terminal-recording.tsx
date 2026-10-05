'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * A real terminal recording (`/media/conversations/<name>.{webm,mp4}`)
 * that loops muted while it is on screen. Nothing but the lazy poster
 * (`<name>-poster.webp`) loads until it scrolls into view, unless it is
 * `eager` (above the fold), and under prefers-reduced-motion the poster
 * stays. Terminals have one theme, so
 * unlike `DemoVideo` there is one recording, not one per site theme.
 */
export function TerminalRecording({
  name,
  alt,
  width,
  height,
  eager = false,
}: {
  name: string;
  alt: string;
  width: number;
  height: number;
  eager?: boolean;
}) {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => true
  );
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || reduced) return;
    const observer = new IntersectionObserver(([entry]) => {
      // Rejected when the browser's autoplay policy says no; the poster stays.
      if (entry?.isIntersecting) video.play().catch(() => undefined);
      else video.pause();
    });
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [reduced]);
  const src = `/media/conversations/${name}`;
  return (
    // The video carries the alt text; the poster behind it is decoration.
    <div
      className="n10-frame relative overflow-hidden rounded-[10px] bg-black"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <img
        src={`${src}-poster.webp`}
        alt=""
        width={width}
        height={height}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : undefined}
        className="absolute inset-0 size-full object-cover"
      />
      <video
        ref={ref}
        className="absolute inset-0 size-full object-cover"
        muted
        loop
        playsInline
        preload={eager ? 'auto' : 'none'}
        aria-label={alt}
      >
        <source src={`${src}.webm`} type="video/webm" />
        <source src={`${src}.mp4`} type="video/mp4" />
      </video>
    </div>
  );
}
