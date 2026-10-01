/**
 * Estimate a terminal's column/row grid from its pane in pixels. Char
 * metrics mirror wterm's own stylesheet (`@wterm/dom/css`: 14px mono
 * ≈ 8.4px wide, 17px rows, 12px padding). Used to size the PTY at
 * launch and to fit the rendered terminal to its pane.
 */
const CHAR_WIDTH = 8.4;
const ROW_HEIGHT = 17;
const PAD_X = 24;
const PAD_Y = 24;

export interface Grid {
  cols: number;
  rows: number;
}

/**
 * Compute the grid for a pane from the wterm element's *measured* cell
 * metrics — the same probe wterm's own observer uses, one `W` wide, so
 * the two never disagree (the fixed estimate overflowed the pane
 * whenever the real glyph was wider, and an average over many glyphs
 * rounds a column differently from wterm, which then resizes the PTY
 * back and forth). Returns null when the element isn't measurable yet
 * (hidden, not laid out); fall back to the estimate.
 */
export function measureTerminalGrid(
  termEl: HTMLElement,
  pane: { width: number; height: number }
): Grid | null {
  const row = document.createElement('div');
  row.className = 'term-row';
  row.style.position = 'absolute';
  row.style.visibility = 'hidden';
  const probe = document.createElement('span');
  probe.textContent = 'W';
  row.appendChild(probe);
  termEl.appendChild(row);
  const charWidth = probe.getBoundingClientRect().width;
  const rowHeight = row.getBoundingClientRect().height;
  row.remove();
  if (charWidth <= 0 || rowHeight <= 0) return null;
  const cs = getComputedStyle(termEl);
  const padX =
    (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY =
    (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return {
    cols: Math.max(20, Math.floor((pane.width - padX) / charWidth)),
    rows: Math.max(5, Math.floor((pane.height - padY) / rowHeight)),
  };
}

/**
 * The box wterm's own observer sizes its grid by — its element's
 * `contentRect`, plus the padding `measureTerminalGrid` takes off —
 * read without waiting for an observer: the border box, less borders
 * and any scrollbar. Fractional, like `contentRect`: `clientWidth`
 * rounds to whole pixels, and near a column boundary lands a column
 * away from wterm, which then resizes the PTY back to its own answer.
 */
export function terminalBox(termEl: HTMLElement): {
  width: number;
  height: number;
} {
  const rect = termEl.getBoundingClientRect();
  const cs = getComputedStyle(termEl);
  const px = (v: string) => parseFloat(v) || 0;
  const bordersX = px(cs.borderLeftWidth) + px(cs.borderRightWidth);
  const bordersY = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
  // Scrollbars are whole pixels; what is left is rounding.
  const scrollbarX = Math.max(
    0,
    Math.round(termEl.offsetWidth - termEl.clientWidth - bordersX)
  );
  const scrollbarY = Math.max(
    0,
    Math.round(termEl.offsetHeight - termEl.clientHeight - bordersY)
  );
  return {
    width: rect.width - bordersX - scrollbarX,
    height: rect.height - bordersY - scrollbarY,
  };
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
 * A hidden `.wterm` is stood up inside the pane so the font and padding
 * that will actually apply are measured rather than assumed — the
 * constants above are a last resort, and half a column of error is the
 * difference between an agent's first frame fitting its pane and
 * wrapping in it. `paneEl` must establish a containing block (the
 * content pane is `relative`), or the probe escapes it.
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
  probe.className = 'wterm';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.width = `${box.width}px`;
  probe.style.height = `${box.height}px`;
  paneEl.appendChild(probe);
  const measured = measureTerminalGrid(probe, box);
  probe.remove();
  return measured ?? estimateTerminalGrid(box);
}
