/**
 * Where keyboard focus goes when the control that had it goes away: a
 * composer closes, a pane is hidden, a toast's button is pressed. The
 * browser drops such focus on the page itself, and a keyboard reader is
 * left at the top of the document. These hand it to what the action
 * leads to instead — the thread a link opened, the prompt a closed box
 * leaves behind.
 */

/** Nothing has focus, or what has it can no longer be seen. Checked
 *  as the pane that held it is hidden, before the browser moves focus
 *  to the page itself. */
export function focusIsLost(): boolean {
  const active = document.activeElement;
  return (
    !(active instanceof HTMLElement) ||
    active === document.body ||
    !active.checkVisibility({ visibilityProperty: true })
  );
}

/**
 * Focus `target` when focus is lost, from the next frame and for as
 * long as the control going away may still take it (`settleMs`): a
 * toast's button keeps focus until the toast unmounts, and then hands
 * it back to whatever it held before, which may be gone too; a prompt
 * that replaces a closed composer may not be mounted or enabled at the
 * first frame. Focus the reader moved somewhere visible themselves
 * stays where it is.
 */
export function refocusAfter(
  target: () => HTMLElement | null | undefined,
  settleMs = 1000
): void {
  const until = performance.now() + settleMs;
  const check = () => {
    if (focusIsLost()) target()?.focus({ preventScroll: true });
    if (performance.now() < until) requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}
