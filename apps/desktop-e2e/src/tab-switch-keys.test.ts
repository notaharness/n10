import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, focusTerminal, tab, tabs } from './setup/app.js';
import { clickAppMenuItem } from './setup/menu.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';

/**
 * Switching the editor tab strip from the keyboard: Ctrl+PgDn/PgUp
 * along the strip, Ctrl+Tab along it or by recent use, and every chord
 * rebindable from Settings → Keyboard.
 */

async function expectActive(page: Page, name: RegExp): Promise<void> {
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
}

async function openSettings(
  app: Parameters<typeof clickAppMenuItem>[0],
  page: Page
): Promise<void> {
  await clickAppMenuItem(app, 'Settings…');
  await expectActive(page, /Settings/);
}

test.describe('Tab switching keys', () => {
  test('Ctrl+PgUp/PgDn step along the strip and wrap, from inside a terminal', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await openNewTerminalDialog(app, page);
    await confirmNewTerminal(page, 'Shell');
    await expect(tabs(page)).toHaveCount(3);
    const terminal = terminalTabs(page);
    await expect(terminal).toHaveAttribute('aria-selected', 'true');

    // The terminal has the keyboard; the chord reaches the strip and
    // never the terminal, which would send it to the shell.
    await focusTerminal(page);
    await page.evaluate(() => {
      const input = document.activeElement as HTMLElement & {
        chordsSeen?: number;
      };
      input.chordsSeen = 0;
      input.addEventListener('keydown', (event) => {
        // Ctrl on its own is not the chord; the terminal may have it.
        if (event.key === 'PageUp') {
          input.chordsSeen = (input.chordsSeen ?? 0) + 1;
        }
      });
      (window as unknown as { terminalInput: HTMLElement }).terminalInput =
        input;
    });
    await page.keyboard.press('Control+PageUp');
    await expectActive(page, /beta/);
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              terminalInput: { chordsSeen: number };
            }
          ).terminalInput.chordsSeen
      )
    ).toBe(0);
    await page.keyboard.press('Control+PageDown');
    await expect(terminal).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+PageDown');
    await expectActive(page, /alpha/);

    // Off by default, Ctrl+Tab goes along the strip too.
    await page.keyboard.press('Control+Tab');
    await expectActive(page, /beta/);
    await page.keyboard.press('Control+Shift+Tab');
    await expectActive(page, /alpha/);
  });

  test('Ctrl+Tab walks recently used tabs while Ctrl is held', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await createWorktree(page, 'gamma');
    await tab(page, /alpha/).click();
    await expectActive(page, /alpha/);
    await openSettings(app, page);
    await page.getByLabel('Ctrl+Tab cycles most recently used tabs').click();
    await expect
      .poll(() => page.evaluate(() => window.n10.getDesktopPrefs()))
      .toMatchObject({ tabCycleMru: true });

    // Most recent first: Settings, alpha, gamma, beta. A tap toggles
    // between the two most recent.
    await page.keyboard.press('Control+Tab');
    await expectActive(page, /alpha/);
    await page.keyboard.press('Control+Tab');
    await expectActive(page, /Settings/);

    // Held, each Tab steps one deeper; letting go picks the tab.
    await page.keyboard.down('Control');
    await page.keyboard.press('Tab');
    await expectActive(page, /alpha/);
    await page.keyboard.press('Tab');
    await expectActive(page, /gamma/);
    await page.keyboard.up('Control');

    // gamma is now the most recent, Settings the one before it.
    await page.keyboard.press('Control+Tab');
    await expectActive(page, /Settings/);
    // Shift walks the other way, to the least recently used.
    await page.keyboard.press('Control+Shift+Tab');
    await expectActive(page, /beta/);
  });

  test('a rebound chord takes over and is kept in the global config', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await openSettings(app, page);

    const recorder = page.getByTestId('shortcut-desktop.tabs.next');
    await expect(recorder).toHaveText('Ctrl+PgDn');
    await recorder.click();
    await expect(recorder).toHaveText('Press keys…');
    await page.keyboard.press('Control+j');
    await expect(recorder).toHaveText('Ctrl+j');
    expect(await page.evaluate(() => window.n10.getKeybindings())).toEqual({
      'desktop.tabs.next': [{ ctrl: true, input: 'j' }],
    });

    // The strip order is alpha, beta, Settings.
    await page.keyboard.press('Control+PageDown');
    await expectActive(page, /Settings/);
    await page.keyboard.press('Control+j');
    await expectActive(page, /alpha/);

    await page.keyboard.press('Control+PageUp');
    await expectActive(page, /Settings/);
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(recorder).toHaveText('Ctrl+PgDn');
    expect(await page.evaluate(() => window.n10.getKeybindings())).toEqual({});
  });
});
