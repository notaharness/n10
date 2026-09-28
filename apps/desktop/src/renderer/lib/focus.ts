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
 * Focus `target` once React has drawn the next frame, if focus was lost
 * on the way. Focus the reader moved somewhere visible themselves stays
 * where it is.
 */
export function refocusAfter(
  target: () => HTMLElement | null | undefined
): void {
  requestAnimationFrame(() => {
    if (focusIsLost()) target()?.focus({ preventScroll: true });
  });
}

/**
 * Focus `target` once React has drawn the next frame, whether or not
 * focus was lost: navigation the reader asked for, such as Back, takes
 * the keyboard to where it leads even when the button they pressed is
 * still on screen.
 */
export function focusAfter(target: () => HTMLElement | null | undefined): void {
  requestAnimationFrame(() => target()?.focus({ preventScroll: true }));
}
