import { openTerminal } from './terminals/xterm.js';
import { resolveTheme } from './theme.js';

/**
 * Estimate a terminal's column/row grid from its pane in pixels. Char
 * metrics mirror the terminal's in styles.css and `terminals/xterm.ts`
 * (13px mono ≈ 7.8px wide, 18px rows, 8/12px padding). The last resort
 * for sizing a PTY at launch.
 */
const CHAR_WIDTH = 7.8;
const ROW_HEIGHT = 18;
const PAD_X = 24;
const PAD_Y = 16;

export interface Grid {
  cols: number;
  rows: number;
}

export function estimateTerminalGrid(
  rect: { width: number; height: number },
  /** Fraction of the width the terminal will occupy (e.g. 0.6 in a
   *  split layout where the diff takes the rest). */
  widthFraction = 1
): Grid {
  const cols = Math.max(
    20,
    Math.floor((rect.width * widthFraction - PAD_X) / CHAR_WIDTH)
  );
  const rows = Math.max(5, Math.floor((rect.height - PAD_Y) / ROW_HEIGHT));
  return { cols, rows };
}

/**
 * The grid a pane would give a terminal, measured before one is in it.
 *
 * A hidden terminal is opened inside the pane, by the same code and in
 * the same renderer as the one that will show the session, and asked
 * for the grid `FitAddon` would fit — the constants above are a last
 * resort, and half a column of error is the difference between an
 * agent's first frame fitting its pane and wrapping in it. `paneEl`
 * must establish a containing block (the content pane is `relative`),
 * or the probe escapes it.
 *
 * A pane with no box yet answers `null`: the minimums above would
 * otherwise turn an unlaid-out pane into a plausible-looking 20x5 and
 * spawn an agent in it. A pane measured without a bar the terminal will
 * sit under says how tall it is in `data-terminal-inset`.
 */
export function paneTerminalGrid(paneEl: HTMLElement): Grid | null {
  const rect = paneEl.getBoundingClientRect();
  const inset = Number(paneEl.dataset.terminalInset) || 0;
  const box = { width: rect.width, height: rect.height - inset };
  if (box.width < 2 || box.height < 2) return null;
  const probe = document.createElement('div');
  probe.className = 'terminal-pane';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.width = `${box.width}px`;
  probe.style.height = `${box.height}px`;
  paneEl.appendChild(probe);
  const host = document.createElement('div');
  host.style.height = '100%';
  probe.appendChild(host);
  const xterm = openTerminal(host, resolveTheme());
  try {
    return xterm.fit.proposeDimensions() ?? estimateTerminalGrid(box);
  } finally {
    xterm.dispose();
    probe.remove();
  }
}
