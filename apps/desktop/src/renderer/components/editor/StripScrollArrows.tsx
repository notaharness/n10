import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { RefObject } from 'react';

export function StripScrollArrows({
  left,
  right,
  track,
}: {
  left: boolean;
  right: boolean;
  track: RefObject<HTMLDivElement | null>;
}) {
  const scroll = (delta: number) =>
    track.current?.scrollBy({
      left: delta,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label="Scroll tabs left"
        aria-disabled={!left}
        onClick={() => {
          if (left) scroll(-240);
        }}
        className="flex h-9 w-6 items-center justify-center text-muted-foreground hover:bg-tab-hover aria-disabled:opacity-40"
      >
        <ChevronLeftIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Scroll tabs right"
        aria-disabled={!right}
        onClick={() => {
          if (right) scroll(240);
        }}
        className="flex h-9 w-6 items-center justify-center text-muted-foreground hover:bg-tab-hover aria-disabled:opacity-40"
      >
        <ChevronRightIcon className="size-3.5" />
      </button>
    </div>
  );
}
