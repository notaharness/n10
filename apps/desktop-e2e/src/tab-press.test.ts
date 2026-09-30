import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, sidebarRow, tab } from './setup/app.js';
import { armContextMenuDismiss } from './setup/menu.js';
import { carryOver, tabNames } from './setup/tab-row.js';

/**
 * Tabs and sidebar rows are chosen as the button goes down, the way
 * browsers' and editors' tabs are, not when it comes up. The other
 * buttons and a drag keep their meanings.
 */

async function pressAndHold(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

test.describe('Choosing on press', () => {
  test.beforeEach(async ({ desktop }) => {
    await createWorktree(desktop.page, 'alpha');
    await createWorktree(desktop.page, 'beta');
    await expect(tab(desktop.page, /beta/)).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('a tab is selected before the button comes up', async ({ desktop }) => {
    const { page } = desktop;
    await pressAndHold(page, tab(page, /alpha/));
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
    await page.mouse.up();
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
  });

  test('a sidebar row opens before the button comes up', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await pressAndHold(page, sidebarRow(page, /alpha/));
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
    await page.mouse.up();
  });

  test('a right-click opens the tab menu without selecting the tab', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await armContextMenuDismiss(app);
    await tab(page, /alpha/).click({ button: 'right' });
    await expect(tab(page, /beta/)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'false');
  });

  test('a tab pressed and dragged is selected and still moves', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await carryOver(page, tab(page, /alpha/), tab(page, /beta/));
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
    await page.mouse.up();
    await expect.poll(() => tabNames(page)).toEqual(['beta', 'alpha']);
  });
});
