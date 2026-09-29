import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  tab,
  visibleText,
} from './setup/app.js';
import { sessionKey } from './setup/session-keys.js';
import {
  currentPid,
  expectAgentFillsPane,
  gridReckonings,
  paneGrid,
  reportedGrids,
} from './setup/terminal-grid.js';

/**
 * Switching between agent tabs. Only the tab on screen has a terminal;
 * the others keep running in tmux, and the host keeps their output.
 * Coming back mounts a fresh terminal from the host's ring buffer, so
 * everything a switch used to get for free from a terminal that never
 * went away — the current screen, the keyboard, the pane's size — it
 * now has to get on arrival.
 */

const BANNER = 'n10-fake-agent-ready';

async function launch(page: Page, branch: string) {
  await createWorktree(page, branch);
  await launchAgentFromRail(page);
  await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
}

/** The highest `working <n>` line the terminal on screen shows. */
async function latestWork(page: Page): Promise<number> {
  const text = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.wterm');
    return el?.innerText ?? '';
  });
  return Math.max(
    0,
    ...[...text.matchAll(/working (\d+)/g)].map((m) => Number(m[1]))
  );
}

test.describe('Streaming agents in two tabs', () => {
  test.use({
    n10Config: { aiCommand: fakeAgent({ stream: true, intervalMs: 100 }) },
  });

  test('only the tab on screen has a terminal, and only it is sent output', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await launch(page, 'alpha');
    await launch(page, 'beta');

    await expect(page.locator('.wterm')).toHaveCount(1);
    // Both agents print at the same rate, so the time beta takes to
    // print ten lines is time alpha printed in too — unseen here.
    const seen = await page.evaluate(
      (beta) =>
        new Promise<string[]>((resolve) => {
          const names = new Set<string>();
          let fromBeta = 0;
          const off = window.n10.onSessionData(({ name }) => {
            names.add(name);
            if (name === beta && ++fromBeta >= 10) {
              off();
              resolve([...names]);
            }
          });
        }),
      await sessionKey(page, 'beta')
    );
    expect(seen).toEqual([await sessionKey(page, 'beta')]);
  });

  test('coming back shows what the agent printed while you were away', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await launch(page, 'alpha');
    await expect.poll(() => latestWork(page)).toBeGreaterThan(3);
    const left = await latestWork(page);

    // Beta started after alpha was left, at the same rate: by the time
    // it has printed fifteen lines, so has alpha, with nothing to draw
    // them into.
    await launch(page, 'beta');
    await expect
      .poll(() => latestWork(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(15);
    await tab(page, /alpha/).click();

    await expect
      .poll(() => latestWork(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(left + 10);
    // …and the terminal is scrolled to them, not somewhere above.
    const atBottom = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.wterm')!;
      return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    });
    expect(atBottom).toBe(true);
  });
});

test.describe('Typing into an agent after a switch', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ echo: true }) } });

  test('the terminal has the keyboard as soon as its tab is back', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await launch(page, 'alpha');
    await launch(page, 'beta');

    await tab(page, /alpha/).click();
    await expect(visibleText(page, BANNER)).toBeVisible();
    // No click into the terminal first: arriving is enough.
    await expect(page.locator('.wterm textarea')).toBeFocused();
    // The palette's Ctrl+K that created beta also reached alpha's
    // terminal, which had the keyboard then; end that line first.
    await page.keyboard.press('Enter');
    await page.keyboard.type('back');
    await page.keyboard.press('Enter');
    await expect(visibleText(page, /echo:back/)).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('Fitting the terminal to its pane', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ printSize: true }) } });

  test('the terminal coming back is fitted to the pane as it is now', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await launch(page, 'alpha');
    const alpha = await currentPid(page);
    const before = await paneGrid(page);
    await launch(page, 'beta');

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const [w, h] = win.getSize();
      win.setSize(w - 200, h - 120);
    });
    await tab(page, /alpha/).click();
    await expect(visibleText(page, BANNER)).toBeVisible();

    // The window changed while alpha had no terminal to notice; the
    // one it mounts must still hand its agent the pane it has now.
    await expect(async () => {
      const expected = await paneGrid(page);
      expect(expected).not.toEqual(before);
      const last = (await reportedGrids(page))
        .filter((g) => g.pid === alpha)
        .at(-1);
      expect(last && { cols: last.cols, rows: last.rows }).toEqual(expected);
    }).toPass({ timeout: 20_000 });
  });

  test('coming back to a pane of the same size leaves the agent alone', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await launch(page, 'alpha');
    // The launch sizes the PTY by estimate; once the agent has the
    // pane's grid, nothing else should resize it.
    await expectAgentFillsPane(page);
    const alpha = await currentPid(page);
    const reports = async () =>
      (await reportedGrids(page)).filter((g) => g.pid === alpha).length;
    const before = await reports();
    await launch(page, 'beta');

    // Each resize makes the app redraw its whole screen: a flicker on
    // every switch, and for an agent that redraws itself, a lot of
    // work. A size report the agent printed after one of the first two
    // arrivals is in the ring buffer by the third, so the last check
    // sees what they provoked, not what the third one does.
    for (let i = 0; i < 2; i++) {
      await tab(page, /alpha/).click();
      await expect(visibleText(page, BANNER)).toBeVisible();
      await expect(page.locator('.wterm')).toHaveCount(1);
      await tab(page, /beta/).click();
      await expect(page.locator('.wterm')).toHaveCount(1);
    }
    await tab(page, /alpha/).click();
    await expect.poll(() => reports()).toBeGreaterThanOrEqual(before);
    expect(await reports()).toBe(before);
  });

  /**
   * The pane widths where a column boundary falls within a pixel's
   * rounding: `clientWidth` says one grid there and wterm's fractional
   * `contentRect` another. An app reckoning by the first answers every
   * resize a column away from wterm's observer — two resizes of the
   * agent each time, and the last one wrong.
   */
  test('a pane on a column boundary gets the grid wterm draws', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await launch(page, 'alpha');
    await expectAgentFillsPane(page);

    const setWidth = (width: number) =>
      app.evaluate(({ BrowserWindow }, w) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setSize(w, win.getSize()[1]);
      }, width);
    const [start] = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getSize()
    );
    let width = start;
    const viewport = () => page.evaluate(() => window.innerWidth);
    // A column is about eight pixels and the rounding half of one, so a
    // width like that turns up within a few dozen one-pixel steps.
    await expect(async () => {
      const previous = await viewport();
      width -= 1;
      await setWidth(width);
      // The window resizes before the page does.
      await expect.poll(viewport).not.toBe(previous);
      const { contentRect, clientBox } = await gridReckonings(page);
      expect(contentRect.cols).not.toBe(clientBox.cols);
    }).toPass({ timeout: 60_000, intervals: [0] });

    await expectAgentFillsPane(page);
  });
});
