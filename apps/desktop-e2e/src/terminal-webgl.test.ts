import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
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
