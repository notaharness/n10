import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  focusTerminal,
  launchAgentFromRail,
  paletteInput,
  visibleText,
} from './setup/app.js';

/**
 * What a modified key sends to the agent.
 *
 * A terminal tells a program about Ctrl, Alt and Shift on a named key —
 * an arrow, Home, Delete — only through xterm's modifier parameter:
 * Ctrl+Left is `ESC [1;5D`, not Left's `ESC [D`. An encoder that drops
 * the parameter sends the bare key, so word motion and word deletion in
 * an agent's prompt quietly turn into single-character ones. On screen
 * the two look the same; only the bytes tell them apart, which is what
 * the fake agent prints here (`\e` for ESC, `^X` for control bytes).
 */

async function launchKeysAgent(page: Page) {
  await createWorktree(page, 'keys');
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('Modified keys in the terminal', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ keys: true }) } });

  const cases: [key: string, bytes: string][] = [
    ['Control+ArrowLeft', '\\e[1;5D'],
    ['Control+ArrowRight', '\\e[1;5C'],
    ['Control+Delete', '\\e[3;5~'],
    ['Control+Backspace', '^H'],
    ['Control+Home', '\\e[1;5H'],
    ['Shift+ArrowUp', '\\e[1;2A'],
    ['Alt+ArrowLeft', '\\e[1;3D'],
  ];

  test('reach the agent with their modifiers', async ({ desktop }) => {
    const { page } = desktop;
    await launchKeysAgent(page);

    // The unmodified key first, so a pass is not the fake agent printing
    // something for every press.
    for (const [key, bytes] of [['ArrowLeft', '\\e[D'], ...cases]) {
      await focusTerminal(page);
      await page.keyboard.press(key);
      await expect(visibleText(page, `key:${bytes}`)).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test('Tab after Escape reaches the agent', async ({ desktop }) => {
    const { page } = desktop;
    await launchKeysAgent(page);

    // wterm reads the pair as leaving the terminal; to an agent it is
    // interrupt, then complete or switch modes.
    await focusTerminal(page);
    await page.keyboard.press('Escape');
    // tmux reads an Escape followed closely by a key as Alt+key; the
    // Escape lands first so the Tab arrives on its own.
    await expect(visibleText(page, /^key:\\e\s*$/)).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press('Tab');
    await expect(visibleText(page, 'key:^I')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('textarea[aria-description*="Escape"]')
    ).toHaveCount(0);
  });

  test('still open the palette when the terminal has focus', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await launchKeysAgent(page);

    // The terminal stops every key it sends its program from going any
    // further; the palette's shortcut must be heard before it does.
    await focusTerminal(page);
    await page.keyboard.press('Control+k');
    await expect(paletteInput(page)).toBeVisible();
  });
});
