import { expect, type Page } from '@playwright/test';

/**
 * The PTY grid an agent was given, as the fake agent's `--print-size`
 * reports it on the terminal on screen, against the grid that terminal
 * can actually show.
 */

/** The element the terminal on screen opened in: not the one in the
 *  pane the editor holds ready for a switch, which is rendered too,
 *  hidden. It carries the grid xterm draws (`data-terminal-grid`). */
export const SHOWN_TERMINAL =
  '[data-editor-panes] > :not([data-spare-pane]) [data-terminal-grid]';

export interface Grid {
  cols: number;
  rows: number;
}
export interface Report extends Grid {
  /** Which agent said so. */
  pid: string;
}

/**
 * Scroll the terminal on screen to the top of its scrollback. xterm
 * puts only the rows in view in the page, so text that scrolled off the
 * top is not there to find until then.
 *
 * xterm moves a few lines per wheel event whatever its delta, so this
 * turns the wheel until the rows drawn stop changing.
 */
export async function scrollTerminalToTop(page: Page): Promise<void> {
  const rows = page.locator(`${SHOWN_TERMINAL} .xterm-rows`);
  await page.locator(SHOWN_TERMINAL).hover();
  let drawn = await rows.innerText();
  for (let i = 0; i < 500; i++) {
    await page.mouse.wheel(0, -500);
    // The rows are drawn on the next frame.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    const now = await rows.innerText();
    if (now === drawn) return;
    drawn = now;
  }
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
 * box and the cells its renderer draws — so this says nothing about how
 * the app computes a grid, only how much of the pane the agent covers.
 *
 * Reckoned as `FitAddon` fits: the box xterm opened in, in whole
 * pixels, less `.xterm`'s padding and the scrollbar xterm reserves,
 * over the size of one cell. A cell is the drawn screen over the grid
 * it was drawn for, read off the renderer's own output rather than the
 * font, which WebGL rounds to device pixels and the DOM does not.
 */
export async function paneGrid(page: Page): Promise<Grid> {
  return page.evaluate((shown) => {
    const host = document.querySelector<HTMLElement>(shown);
    const xterm = host?.querySelector<HTMLElement>('.xterm');
    const screen = host?.querySelector<HTMLElement>('.xterm-screen');
    if (!host || !xterm || !screen) throw new Error('no terminal on screen');
    const [cols, rows] = host.dataset.terminalGrid!.split('x').map(Number);
    const drawn = screen.getBoundingClientRect();
    const box = getComputedStyle(host);
    const pad = getComputedStyle(xterm);
    const px = (v: string) => parseInt(v, 10) || 0;
    // xterm's default scrollbar width, which FitAddon keeps clear.
    const scrollbar = 14;
    const width =
      px(box.width) - px(pad.paddingLeft) - px(pad.paddingRight) - scrollbar;
    const height = px(box.height) - px(pad.paddingTop) - px(pad.paddingBottom);
    return {
      cols: Math.floor(width / (drawn.width / cols)),
      rows: Math.floor(height / (drawn.height / rows)),
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
