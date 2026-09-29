import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  tab,
  visibleText,
} from './setup/app.js';
import { sessionKey } from './setup/session-keys.js';
import { currentPid, paneGrid, reportedGrids } from './setup/terminal-grid.js';

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
    const seen = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const names = new Set<string>();
          const off = window.n10.onSessionData(({ name }) => names.add(name));
          setTimeout(() => {
            off();
            resolve([...names]);
          }, 1500);
        })
    );
    // Both agents print every 100 ms; the hidden one reaches no one.
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

test.describe('Resizing while a tab is hidden', () => {
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
    const expected = await paneGrid(page);
    expect(expected).not.toEqual(before);
    await expect
      .poll(
        async () => {
          const last = (await reportedGrids(page))
            .filter((g) => g.pid === alpha)
            .at(-1);
          return last ? { cols: last.cols, rows: last.rows } : null;
        },
        { timeout: 20_000 }
      )
      .toEqual(expected);
  });
});
