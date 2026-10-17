'use client';

import { useTheme } from 'next-themes';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ThemeImage } from '@/components/theme-image';
import { cn } from '@/lib/cn';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const subscribeNever = () => () => undefined;

/** The site's theme once hydrated; null on the server and before. */
function useSiteTheme(): 'light' | 'dark' | null {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
  const { resolvedTheme } = useTheme();
  if (!hydrated) return null;
  return resolvedTheme === 'light' || resolvedTheme === 'dark'
    ? resolvedTheme
    : null;
}

/**
 * A looping feature demo, recorded in both themes
 * (`/media/<name>-<theme>.{webm,mp4}`), playing the site's current one.
 *
 * The poster is a `ThemeImage` behind the video rather than the
 * `poster` attribute, so CSS picks it by the `.dark` class before
 * hydration and only the visible one is fetched. It carries the alt
 * text until the video, which carries it after, renders. The video is
 * keyed by theme: a theme change swaps in the other recording at the
 * same time into the clip. The desktop clips are recorded from one
 * script on one clock, so the frames line up; the terminal clip is
 * filmed in real time and may be a few frames apart. Nothing is
 * fetched for a theme not shown.
 *
 * Under prefers-reduced-motion it stays still. `autoplay` is never
 * server-rendered, since the browser would act on it before hydration
 * could take it back;
 * playback starts from an effect instead.
 */
export function DemoVideo({
  name,
  alt,
  className,
}: {
  name: string;
  alt: string;
  className?: string;
}) {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => true
  );
  const theme = useSiteTheme();
  const ref = useRef<HTMLVideoElement>(null);
  const resumeAt = useRef(0);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (reduced) {
      video.pause();
      return;
    }
    if (resumeAt.current) video.currentTime = resumeAt.current;
    // Rejected when the browser's autoplay policy says no; the poster stays.
    video.play().catch(() => undefined);
    return () => {
      resumeAt.current = video.currentTime;
    };
  }, [reduced, theme]);
  return (
    <div className={cn('relative aspect-[8/5] overflow-hidden', className)}>
      <ThemeImage
        name={name}
        suffix="-poster"
        alt={theme ? '' : alt}
        className="absolute inset-0 size-full object-cover"
      />
      {theme && (
        <video
          key={theme}
          ref={ref}
          className="absolute inset-0 size-full object-cover"
          muted
          loop
          playsInline
          preload="none"
          aria-label={alt}
        >
          <source src={`/media/${name}-${theme}.webm`} type="video/webm" />
          <source src={`/media/${name}-${theme}.mp4`} type="video/mp4" />
        </video>
      )}
    </div>
  );
}
