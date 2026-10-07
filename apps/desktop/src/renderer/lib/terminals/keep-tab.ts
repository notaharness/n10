/** The part of a wterm terminal whose input `keepTabInTerminal` reaches. */
interface TerminalWithInput {
  element: HTMLElement;
}

/** wterm's description of the Escape-then-Tab exit, word for word. */
const EXIT_HINT =
  'Press Escape, then Tab to move focus out of the terminal, or Shift+Tab to move focus backward.';

/**
 * Keep Tab for the program after Escape.
 *
 * wterm reads Escape then Tab as leaving the terminal, and lets the
 * browser move focus instead of sending the Tab. In an agent, Escape
 * then Tab is typing: interrupt, then complete or switch modes. wterm
 * has no option for it, so the flag that pairs the two keys is cleared
 * as a Tab reaches the terminal, ahead of wterm's own listener on its
 * input. If a later wterm drops the flag, this does nothing, and
 * `terminal-keys.test.ts` says so.
 */
export function keepTabInTerminal(term: TerminalWithInput): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const { input } = term as unknown as {
      input?: { tabExitArmed?: boolean } | null;
    };
    if (input && 'tabExitArmed' in input) input.tabExitArmed = false;
  };
  // Its description says the pair leaves; here it does not.
  const field = term.element.querySelector('textarea');
  const said = field?.getAttribute('aria-description');
  if (field && said?.includes(EXIT_HINT)) {
    const rest = said.replace(EXIT_HINT, '').trim();
    if (rest) field.setAttribute('aria-description', rest);
    else field.removeAttribute('aria-description');
  }
  term.element.addEventListener('keydown', onKey, true);
  return () => term.element.removeEventListener('keydown', onKey, true);
}
