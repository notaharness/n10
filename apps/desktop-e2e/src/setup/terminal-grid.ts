import { expect, type Page } from '@playwright/test';

/**
 * The PTY grid an agent was given, as the fake agent's `--print-size`
 * reports it on the terminal on screen, against the grid that terminal
 * can actually show.
 */

/** The terminal on screen: not the one in the pane the editor holds
 *  ready for a switch, which is rendered too, hidden. */
export const SHOWN_TERMINAL =
  '[data-editor-panes] > :not([data-spare-pane]) .wterm';

export interface Grid {
  cols: number;
  rows: number;
}
export interface Report extends Grid {
  /** Which agent said so. */
  pid: string;
}

/** Every grid an agent has reported, oldest first. */
export async function reportedGrids(page: Page): Promise<Report[]> {
  const text = await page.evaluate(() => document.body.innerText);
  return [...text.matchAll(/size:(\d+)x(\d+)#(\d+)/g)].map((m) => ({
    cols: Number(m[1]),
    rows: Number(m[2]),
    pid: m[3],
  }));
}

/** The agent currently reporting, once it has said anything. */
export async function currentPid(page: Page): Promise<string> {
  await expect
    .poll(async () => (await reportedGrids(page)).length, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  return (await reportedGrids(page)).at(-1)!.pid;
}

/**
 * The grid that fills the terminal on screen, measured off its own
 * box and cell metrics — so this says nothing about how the app
 * computes a grid, only how much of the pane the agent covers.
 *
 * Reckoned the way wterm lays out its own grid: its observer's
 * `contentRect` (fractional, inside borders, scrollbar and padding)
 * over the width of one glyph. Any other reckoning can land a column
 * away from wterm's, and its observer then resizes the PTY back to its
 * own answer.
 */
export async function paneGrid(page: Page): Promise<Grid> {
  return (await gridReckonings(page)).contentRect;
}

/**
 * The terminal's grid by wterm's reckoning, and by one that reads the
 * box from `clientWidth`/`clientHeight`, which round to whole pixels.
 * They differ when a column (or row) boundary falls within that
 * rounding — the pane widths where an app reckoning the second way
 * and wterm resize the PTY back and forth.
 */
export async function gridReckonings(
  page: Page
): Promise<{ contentRect: Grid; clientBox: Grid }> {
  return page.evaluate((shown) => {
    const el = document.querySelector<HTMLElement>(shown);
    const row = el?.querySelector<HTMLElement>('.term-row');
    if (!el || !row) throw new Error('no terminal on screen');
    const cs = getComputedStyle(el);
    const px = (v: string) => parseFloat(v) || 0;
    const probe = document.createElement('div');
    probe.className = 'term-row';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    const span = document.createElement('span');
    // As wterm's probe: the font's width, not the cell's styled one.
    span.style.width = 'auto';
    span.textContent = 'W';
    probe.appendChild(span);
    el.appendChild(probe);
    const charWidth = span.getBoundingClientRect().width;
    const rowHeight = probe.getBoundingClientRect().height;
    probe.remove();
    const padX = px(cs.paddingLeft) + px(cs.paddingRight);
    const padY = px(cs.paddingTop) + px(cs.paddingBottom);
    const bordersX = px(cs.borderLeftWidth) + px(cs.borderRightWidth);
    const bordersY = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    const rect = el.getBoundingClientRect();
    const grid = (width: number, height: number) => ({
      cols: Math.floor((width - padX) / charWidth),
      rows: Math.floor((height - padY) / rowHeight),
    });
    return {
      contentRect: grid(
        rect.width -
          bordersX -
          Math.round(el.offsetWidth - el.clientWidth - bordersX),
        rect.height -
          bordersY -
          Math.round(el.offsetHeight - el.clientHeight - bordersY)
      ),
      clientBox: grid(el.clientWidth, el.clientHeight),
    };
  }, SHOWN_TERMINAL);
}

/**
 * Wait for the agent to settle on the grid that fills its pane.
 *
 * `notPid` is the agent that was there before. Without it a restart
 * reads the *previous* agent's last line — still on screen, and still
 * correct — and passes on a terminal that never resized at all.
 *
 * The pane is measured again on every look, not once up front: a
 * restarted agent's terminal still holds its predecessor's scrollback,
 * and the scrollbar that comes with it can appear just after a single
 * measurement, taking a column from the grid the agent rightly gets.
 */
export async function expectAgentFillsPane(
  page: Page,
  notPid?: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        const last = (await reportedGrids(page))
          .filter((g) => g.pid !== notPid)
          .at(-1);
        const pane = await paneGrid(page);
        return last?.cols === pane.cols && last.rows === pane.rows
          ? 'fills the pane'
          : { agent: last ?? null, pane };
      },
      { timeout: 20_000 }
    )
    .toBe('fills the pane');
}
