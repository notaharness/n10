import { useEffect, useEffectEvent } from 'react';
import { inField } from '../../../lib/field-keys.js';
import { usePaneShown } from '../../../lib/tabs/pane-shown.js';

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
  const prev = useEffectEvent(handlers.onPrev);
  const next = useEffectEvent(handlers.onNext);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      const step = STEPS[e.key];
      if (!step || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey)
        return;
      if (inField(e.target)) return;
      e.preventDefault();
      if (step < 0) prev();
      else next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown]);
}
