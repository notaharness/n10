import { useEffect } from 'react';

export interface StepperShortcuts {
  onNext: () => void;
  onPrev: () => void;
  onEdit: () => void;
  onPost: () => void;
  onDiscard: () => void;
  onExit: () => void;
}

/** Fields take every key of their own. */
const FIELDS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
/** Controls Enter presses: on one, Enter is that control's, not Post. */
const CONTROLS =
  'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"]';

/**
 * Keyboard shortcuts for the review walkthrough.
 *
 * Ignored in a field, which takes its own keys; Enter on a focused
 * button or link presses that, never Post. Also ignored while `enabled`
 * is off (the card's textarea is being edited) and for keys already
 * handled (`defaultPrevented`) — `d` discards and `Enter` posts, so a
 * stray keypress must not reach them. The listener is on `window`
 * because the walkthrough has no single focused element to hang it
 * off; it is mounted only in the active tab, and only while it shows,
 * so no other tab hears these keys.
 */
export function useStepperShortcuts(
  enabled: boolean,
  handlers: StepperShortcuts
): void {
  const { onNext, onPrev, onEdit, onPost, onDiscard, onExit } = handlers;
  useEffect(() => {
    if (!enabled) return;
    // Built inside the effect so the table closes over the same
    // callbacks the dependency list names — a `handlers` object read
    // directly would be a new reference every render and re-bind the
    // listener each time.
    const actions: Record<string, () => void> = {
      ArrowDown: onNext,
      ArrowRight: onNext,
      j: onNext,
      ArrowUp: onPrev,
      ArrowLeft: onPrev,
      k: onPrev,
      e: onEdit,
      p: onPost,
      Enter: onPost,
      d: onDiscard,
      Escape: onExit,
    };
    const onKey = (e: KeyboardEvent) => {
      // Something nearer the target took the key: a keyboard drag in
      // the tab row drops on Enter and cancels on Escape, and must not
      // post or exit here as well.
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest(FIELDS)) return;
      if (e.key === 'Enter' && t?.closest(CONTROLS)) return;
      const run = actions[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onNext, onPrev, onEdit, onPost, onDiscard, onExit]);
}
