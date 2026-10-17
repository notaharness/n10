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
  SHOWN_TERMINAL,
  currentPid,
  expectAgentFillsPane,
  paneGrid,
  reportedGrids,
} from './setup/terminal-grid.js';

/**
 * Switching between agent tabs. The tab on screen has a terminal, and
 * so does one more, held ready off screen (the tab left last, or the
 * one the pointer rests on); the others keep running in tmux, and the
 * host keeps their output. Coming back to one of those mounts a fresh
 * terminal from the host's ring buffer, so everything a switch used to
 * get for free from a terminal that never went away — the current
 * screen, the keyboard, the pane's size — it has to get on arrival.
 */

const BANNER = 'n10-fake-agent-ready';

async function launch(page: Page, branch: string) {
  await createWorktree(page, branch);
  await launchAgentFromRail(page);
  await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
}

/** The highest `working <n>` line the terminal on screen shows. */
async function latestWork(page: Page): Promise<number> {
  const text = await page.evaluate(
    (shown) => document.querySelector<HTMLElement>(shown)?.innerText ?? '',
    SHOWN_TERMINAL
  );
  return Math.max(
    0,
    ...[...text.matchAll(/working (\d+)/g)].map((m) => Number(m[1]))
  );
}

test.describe('Streaming agents in several tabs', () => {
  test.use({
    n10Config: { aiCommand: fakeAgent({ stream: true, intervalMs: 100 }) },
  });

  test('only the tab on screen and the one held ready have terminals, and only they are sent output', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await launch(page, 'alpha');
    await launch(page, 'beta');
    await launch(page, 'gamma');

    // Gamma on screen, beta (left last) held ready, alpha neither.
    await expect(page.locator('[data-terminal-grid]')).toHaveCount(2);
    await expect(page.locator(SHOWN_TERMINAL)).toHaveCount(1);
    // All agents print at the same rate, so the time gamma takes to
    // print ten lines is time alpha printed in too — unsent here.
    const seen = await page.evaluate(
      (gamma) =>
        new Promise<string[]>((resolve) => {
          const names = new Set<string>();
          let fromGamma = 0;
          const off = window.n10.onSessionData(({ name }) => {
            names.add(name);
            if (name === gamma && ++fromGamma >= 10) {
              off();
              resolve([...names]);
            }
          });
        }),
      await sessionKey(page, 'gamma')
    );
    expect(seen.sort()).toEqual(
      [await sessionKey(page, 'beta'), await sessionKey(page, 'gamma')].sort()
    );
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
    // them into once gamma's arrival stopped holding it ready.
    await launch(page, 'beta');
    await launch(page, 'gamma');
    await expect
      .poll(() => latestWork(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(15);
    await tab(page, /alpha/).click();

    // The terminal draws only the rows in its viewport, so reading
    // them also says it is scrolled to the latest, not somewhere above.
    await expect
      .poll(() => latestWork(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(left + 10);
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
    await expect(page.locator(`${SHOWN_TERMINAL} textarea`)).toBeFocused();
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
      await expect(page.locator(SHOWN_TERMINAL)).toHaveCount(1);
      await tab(page, /beta/).click();
      await expect(page.locator(SHOWN_TERMINAL)).toHaveCount(1);
    }
    await tab(page, /alpha/).click();
    await expect.poll(() => reports()).toBeGreaterThanOrEqual(before);
    expect(await reports()).toBe(before);
  });
});
