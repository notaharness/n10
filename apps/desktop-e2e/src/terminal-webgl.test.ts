import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  tab,
  visibleText,
} from './setup/app.js';
import {
  SHOWN_TERMINAL,
  expectAgentFillsPane,
  paneGrid,
} from './setup/terminal-grid.js';

/**
 * Terminals draw with xterm's WebGL renderer where the window has
 * WebGL, and the rest of the suite runs without a GPU, on xterm's DOM
 * renderer. This test gives the window software WebGL: its rows are
 * pixels then, not text, so what it can read is the renderer and the
 * grid until the context is lost, and the text once xterm has fallen
 * back to the DOM.
 */

test.describe('A terminal drawn with WebGL', () => {
  test.use({
    webgl: true,
    n10Config: { aiCommand: fakeAgent({ printSize: true }) },
  });

  test('fills its pane, and falls back to the DOM when the context is lost', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'webgl');
    await launchAgentFromRail(page);
    const shown = page.locator(SHOWN_TERMINAL);
    await expect(shown).toHaveAttribute('data-terminal-renderer', 'webgl', {
      timeout: 30_000,
    });
    await expect(shown.locator('canvas').first()).toBeAttached();
    await expect
      .poll(async () => {
        const grid = await shown.getAttribute('data-terminal-grid');
        const pane = await paneGrid(page);
        return grid === `${pane.cols}x${pane.rows}`;
      })
      .toBe(true);
    // Drawn into the canvas, the agent's output is no text in the page.
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeHidden();

    // What a suspend or the GPU process going away does to it.
    await page.evaluate((sel) => {
      for (const canvas of Array.from(
        document.querySelectorAll<HTMLCanvasElement>(`${sel} canvas`)
      )) {
        const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
        const lose: WEBGL_lose_context | null | undefined =
          gl?.getExtension('WEBGL_lose_context');
        lose?.loseContext();
      }
    }, SHOWN_TERMINAL);

    await expect(shown).toHaveAttribute('data-terminal-renderer', 'dom');
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();
    // The DOM's cells are not rounded to device pixels, so the grid
    // changed with the renderer, and the agent was told.
    await expectAgentFillsPane(page);
  });
});

test.describe('Terminals coming and going around one on screen', () => {
  test.use({
    webgl: true,
    n10Config: { aiCommand: fakeAgent({ echo: true }) },
  });

  /**
   * Every terminal mounted makes a WebGL context, and Chromium keeps 16
   * in a page, evicting the oldest past that. A terminal let go of has
   * to give its context back, or the one that stays on screen is the
   * oldest and goes.
   */
  test('keeps WebGL through many more terminals than Chromium keeps contexts', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const shown = page.locator(SHOWN_TERMINAL);
    for (const branch of ['alpha', 'beta', 'gamma']) {
      await createWorktree(page, branch);
      await launchAgentFromRail(page);
      await expect(shown).toHaveAttribute('data-terminal-renderer', 'webgl', {
        timeout: 30_000,
      });
    }
    await tab(page, /alpha/).click();
    await expect(shown).toHaveAttribute('data-terminal-renderer', 'webgl');
    // Every canvas is kept, so none is garbage collected: a context
    // nobody released stays live, as it can for as long as the heap
    // stays quiet, rather than for as long as this test happens to wait.
    await page.evaluate(() => {
      const w = window as unknown as { mounted: number; kept: Element[] };
      w.mounted = 0;
      w.kept = [];
      new MutationObserver((records) => {
        for (const r of records)
          for (const n of Array.from(r.addedNodes)) {
            if (!(n instanceof HTMLElement)) continue;
            if (n.classList.contains('xterm')) w.mounted++;
            w.kept.push(...Array.from(n.querySelectorAll('canvas')));
            if (n instanceof HTMLCanvasElement) w.kept.push(n);
          }
      }).observe(document.body, { childList: true, subtree: true });
    });

    // Resting on a tab holds its pane ready, with a terminal of its
    // own; resting on the other lets that one go. A rest can be passed
    // over while a pane let go of is still reading, so each is tried
    // until it mounts.
    const mounted = () =>
      page.evaluate(() => (window as unknown as { mounted: number }).mounted);
    for (let i = 0; i < 20; i++) {
      const before = await mounted();
      await expect(async () => {
        await page.mouse.move(5, 5);
        await tab(page, [/beta/, /gamma/][i % 2]).hover();
        await expect.poll(mounted, { timeout: 1_000 }).toBeGreaterThan(before);
      }).toPass({ timeout: 15_000 });
    }

    // An evicted context is given up for lost after xterm's 3 s wait
    // for it to come back, so the terminal is looked at once that has
    // passed.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- what is waited out is an event that must not come
    await page.waitForTimeout(4_000);
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(shown).toHaveAttribute('data-terminal-renderer', 'webgl');
  });
});
