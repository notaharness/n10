'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * A real terminal recording (`/media/context-switcher/<name>.{webm,mp4}`)
 * that loops muted while it is on screen. Nothing but the lazy poster
 * (`<name>-poster.webp`) loads until it scrolls into view, and under
 * prefers-reduced-motion the poster stays. Terminals have one theme, so
 * unlike `DemoVideo` there is one recording, not one per site theme.
 */
export function TerminalRecording({
  name,
  alt,
  width,
  height,
}: {
  name: string;
  alt: string;
  width: number;
  height: number;
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
  const src = `/media/context-switcher/${name}`;
  return (
    <div
      className="n10-frame relative overflow-hidden rounded-[10px] bg-black"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <img
        src={`${src}-poster.webp`}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        className="absolute inset-0 size-full object-cover"
      />
      <video
        ref={ref}
        className="absolute inset-0 size-full object-cover"
        muted
        loop
        playsInline
        preload="none"
        aria-label={alt}
      >
        <source src={`${src}.webm`} type="video/webm" />
        <source src={`${src}.mp4`} type="video/mp4" />
      </video>
    </div>
  );
}

/** Stands in for a recording until it exists. */
export function RecordingPlaceholder({ alt }: { alt: string }) {
  return (
    <div
      role="img"
      aria-label={alt}
      className="n10-frame bg-fd-card text-fd-muted-foreground flex aspect-[16/10] items-center justify-center rounded-[10px] font-mono text-sm"
    >
      Recording coming soon
    </div>
  );
}
