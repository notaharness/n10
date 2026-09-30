'use client';

import { Pause, Play } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Uses the hero's packet animation and motion preference, with a local pause. */
export function BeamFigure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED).matches,
    () => false
  );
  const [choice, setChoice] = useState<boolean | null>(null);
  const playing = choice ?? !reduced;
  const Icon = playing ? Pause : Play;

  return (
    <div className="relative">
      <svg
        viewBox="0 0 400 250"
        role="img"
        aria-label={label}
        className="n10-mesh text-fd-foreground h-auto w-full"
        data-playing={choice === null ? undefined : String(choice)}
      >
        {children}
      </svg>
      <button
        type="button"
        onClick={() => setChoice(!playing)}
        aria-label={`${playing ? 'Pause' : 'Play'}: ${label}`}
        className="text-fd-muted-foreground hover:bg-fd-accent focus-visible:ring-fd-ring absolute right-0 bottom-0 inline-flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2"
      >
        <Icon className="size-4" aria-hidden />
      </button>
    </div>
  );
}
