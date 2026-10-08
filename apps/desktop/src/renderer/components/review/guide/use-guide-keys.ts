import { useEffect, useRef } from 'react';
import { usePaneShown } from '../../../lib/tabs/pane-shown.js';

/** Fields and controls that take these keys for themselves. */
const OWN_KEYS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="tablist"]';

const STEPS: Record<string, -1 | 1> = {
  ArrowLeft: -1,
  PageUp: -1,
  ArrowRight: 1,
  PageDown: 1,
};

/**
 * ← and → (and Page Up/Down) step through the guide. The listener is on
 * `window`, like the draft walkthrough's, since a slide has no single
 * element that holds focus; it is mounted only while the guide shows,
 * and stays quiet in a pane rendered ahead of its tab.
 */
export function useGuideKeys(handlers: {
  onPrev: () => void;
  onNext: () => void;
}): void {
  const shown = usePaneShown();
  // The latest handlers, so the listener is bound once per showing.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      const step = STEPS[e.key];
      if (!step || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey)
        return;
      if ((e.target as HTMLElement | null)?.closest(OWN_KEYS)) return;
      e.preventDefault();
      if (step < 0) latest.current.onPrev();
      else latest.current.onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown]);
}
