import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';

/**
 * Following the system theme: the UI and its terminals paint from one
 * signal, Electron's `nativeTheme`, which both OS scheme changes and
 * the in-app preference go through. The page's own colour-scheme media
 * query is held at light throughout, so a window that still followed
 * it — or followed it in only one place — would be caught out on the
 * dark steps.
 */

type Theme = 'light' | 'dark';

/** What the OS switching does to the main process: `nativeTheme`
 *  changes and fires 'updated'. */
async function switchSystemTheme(
  app: ElectronApplication,
  theme: Theme
): Promise<void> {
  await app.evaluate(({ nativeTheme }, next) => {
    nativeTheme.themeSource = next;
  }, theme);
}

/** A new shell tab, once its prompt is up: a keystroke sent while the
 *  shell is still starting is read in cooked mode and lost. */
async function openShell(app: ElectronApplication, page: Page) {
  const before = await terminalTabs(page).count();
  await openNewTerminalDialog(app, page);
  await confirmNewTerminal(page, 'Shell');
  await expect(terminalTabs(page)).toHaveCount(before + 1);
  await expect(
    page
      .locator('[data-terminal-pane]')
      .filter({ visible: true })
      .getByText(/\S/)
      .first()
  ).toBeVisible({ timeout: 15_000 });
}

async function painted(page: Page): Promise<{ ui: Theme; terminal: Theme }> {
  return page.evaluate(() => ({
    ui: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    terminal: document
      .querySelector('[data-terminal-pane] .wterm')
      ?.classList.contains('theme-light')
      ? 'light'
      : 'dark',
  }));
}

test.describe('Theme', () => {
  test('the UI and the terminal follow the system theme together: dark, light, dark', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await page.emulateMedia({ colorScheme: 'light' });

    await openShell(app, page);

    for (const theme of ['dark', 'light', 'dark'] as const) {
      await switchSystemTheme(app, theme);
      await expect
        .poll(() => painted(page))
        .toEqual({ ui: theme, terminal: theme });
    }
  });
});
