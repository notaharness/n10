import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  visibleText,
} from './setup/app.js';
import {
  SHOWN_TERMINAL,
  currentPid,
  paneGrid,
  reportedGrids,
} from './setup/terminal-grid.js';

/**
 * A pane wider than wterm's grid can hold. wterm keeps at most 256
 * columns and wraps anything past them, so an agent told it has more
 * draws lines that wrap onto the row below — and the next line, placed
 * there by cursor position, lands on top of the wrapped part. A 4K
 * display at 1x scaling has such a pane; zooming the window out gives
 * the 1600px test screen one.
 */

// `MAX_GRID` in the renderer's terminal-grid.ts: what the pinned wterm
// holds. An upgrade that raises it changes this, that and the clamp in
// apps/cli-wterm-host's client.ts together.
const WTERM_MAX_COLS = 256;
const BANNER = 'n10-fake-agent-ready';

test.use({
  n10Config: {
    aiCommand: fakeAgent({ printSize: true, drawScreen: true }),
  },
});

test('an agent in a pane wider than wterm draws within the grid wterm has', async ({
  desktop,
}) => {
  const { app, page } = desktop;
  await createWorktree(page, 'wide');
  await launchAgentFromRail(page);
  await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
  const pid = await currentPid(page);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(0.25);
  });
  await expect
    .poll(async () => (await paneGrid(page)).cols, { timeout: 10_000 })
    .toBeGreaterThan(WTERM_MAX_COLS);

  // The rule the agent last drew fills one row, and the line placed
  // under it is on its own. Under a terminal narrower than the agent
  // was told, the rule wraps and that line lands on its tail.
  const screen = async () => {
    const told = (await reportedGrids(page))
      .filter((g) => g.pid === pid)
      .at(-1);
    const rows = await page.evaluate(
      (shown) =>
        Array.from(
          document.querySelectorAll<HTMLElement>(`${shown} .term-row`),
          (r) => r.textContent?.trimEnd() ?? ''
        ),
      SHOWN_TERMINAL
    );
    const below = rows.findIndex((r) => r.startsWith('below-the-rule'));
    return {
      cols: told?.cols,
      ruleFillsItsRow: rows[below - 1] === '='.repeat(told?.cols ?? 0),
      below: rows[below],
    };
  };
  await expect.poll(screen, { timeout: 20_000 }).toEqual({
    cols: WTERM_MAX_COLS,
    ruleFillsItsRow: true,
    below: 'below-the-rule',
  });
});
