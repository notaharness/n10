import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  dismissSessionMenu,
  openRoster,
  sessionMenu,
  sidebarRow,
  tab,
  tabs,
} from './setup/app.js';
import { armContextMenuChoice, clickAppMenuItem } from './setup/menu.js';
import { startLoneShells } from './setup/terminals.js';

const rosterRows = (page: Page) =>
  page.locator('[data-group-roster] [data-roster-row]');

/** Close every open tab: Close All from a tab's menu, the first row's
 *  in its group's roster when the tabs stand behind a chip. */
async function closeAllTabs(
  page: Page,
  app: ElectronApplication
): Promise<void> {
  const chip = page.locator('[data-group-chip]').first();
  await armContextMenuChoice(app, 'Close All');
  if ((await chip.count()) > 0) {
    await openRoster(page, chip);
    await rosterRows(page).first().click({ button: 'right' });
  } else {
    await tabs(page).first().click({ button: 'right' });
  }
  await expect(tabs(page)).toHaveCount(0);
}

/** End a terminal's session to close its tab, as the dialog asks. */
async function confirmEndSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'End session & close' }).click();
}

test.describe('Editor tabs', () => {
  test('a single click previews, and the next preview replaces it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await closeAllTabs(page, desktop.app);

    await sidebarRow(page, /alpha/).click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(tab(page, /alpha/)).toBeVisible();

    // A preview tab is reused rather than stacked.
    await sidebarRow(page, /beta/).click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(tab(page, /beta/)).toBeVisible();
    await expect(tab(page, /alpha/)).toHaveCount(0);
  });

  test('a double click pins the tab so the next preview opens beside it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await closeAllTabs(page, desktop.app);

    await sidebarRow(page, /alpha/).dblclick();
    // Activating an idle row also opens its session menu; while that
    // modal is up the rest of the app is hidden from role queries.
    await dismissSessionMenu(page);
    await expect(tab(page, /alpha/)).toBeVisible();

    // The two are their repository's, behind its chip.
    await sidebarRow(page, /beta/).click();
    const chip = page.locator('[data-group-chip^="place:"]');
    await expect(chip.locator('[data-group-count]')).toHaveText('2');
    await openRoster(page, chip);
    await expect(rosterRows(page)).toHaveCount(2);
    await expect(rosterRows(page).filter({ hasText: 'alpha' })).toHaveCount(1);
    await expect(rosterRows(page).filter({ hasText: 'beta' })).toHaveCount(1);
  });

  test('Enter on a row whose tab is open behind another opens its session menu', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await expect(tab(page, /beta/)).toHaveAttribute('aria-selected', 'true');

    // alpha's pane is mounted but not in front: the request must reach
    // it as it comes forward, not be dropped for arriving while it is
    // still behind.
    await sidebarRow(page, /alpha/).focus();
    await page.keyboard.press('Enter');
    await expect(sessionMenu(page)).toBeVisible();
    await dismissSessionMenu(page);
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
  });

  // Beside the worktree, a shell alone in its directory: two tabs of
  // their own on the strip. Closing a terminal asks first.
  test('Close Others from the tab context menu keeps only that tab', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    startLoneShells(desktop.homeDir, ['beta']);
    await expect(tabs(page)).toHaveCount(2, { timeout: 30_000 });

    await armContextMenuChoice(desktop.app, 'Close Others');
    await tab(page, /alpha/).click({ button: 'right' });
    await confirmEndSession(page);

    await expect(tabs(page)).toHaveCount(1);
    await expect(tab(page, /alpha/)).toBeVisible();
  });

  test('Close All from the tab context menu empties the strip', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    startLoneShells(desktop.homeDir, ['beta']);
    await expect(tabs(page)).toHaveCount(2, { timeout: 30_000 });

    await armContextMenuChoice(desktop.app, 'Close All');
    await tab(page, /beta/).click({ button: 'right' });
    await confirmEndSession(page);

    await expect(tabs(page)).toHaveCount(0);

    // …and stays empty through a sidebar refresh. The effect that opens
    // a tab per running agent reacts to the sidebar model, so a refetch
    // is when a closed tab would come back if that effect ever stopped
    // respecting manual closes.
    await page.locator('aside').getByLabel('Refresh').click();
    await expect(tabs(page)).toHaveCount(0);
  });

  test('a middle click closes a tab', async ({ desktop }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await expect(tab(page, /alpha/)).toBeVisible();

    await tab(page, /alpha/).click({ button: 'middle' });
    await expect(tab(page, /alpha/)).toHaveCount(0);
  });

  test('the native Settings menu item opens settings as its own tab', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');

    // Ctrl+, is a native menu accelerator, not a renderer keybinding,
    // so this drives the real menu item — exercising menu.ts →
    // sendMenuCommand → the renderer's onMenuCommand routing.
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();

    await tab(page, /alpha/).click();
    await expect(tab(page, /Settings/)).toBeVisible();
    await expect(tabs(page)).toHaveCount(2);

    // Re-opening settings focuses the existing tab instead of stacking.
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tabs(page)).toHaveCount(2);
  });
});
