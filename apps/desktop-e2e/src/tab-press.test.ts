import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, sidebarRow, switchRepo, tab } from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import { armContextMenuDismiss } from './setup/menu.js';
import { carryOver, tabNames } from './setup/tab-row.js';

/**
 * Tabs and sidebar rows are chosen as the button goes down, the way
 * browsers' and editors' tabs are, not when it comes up. The other
 * buttons and a drag keep their meanings, another repository's tab
 * included: choosing it on press opens its repository, and the press
 * still lifts it.
 */

async function pressAndHold(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

/** Press on a tab and move a few pixels past the drag threshold. */
async function pressAndNudge(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('not laid out');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y, { steps: 4 });
}

/** Where the tab is drawn off its place: lifted, it follows the
 *  pointer, `LIFTED`. */
const transformOf = (t: Locator) => t.evaluate((el) => el.style.transform);
const LIFTED = /^translate3d\((?!0px, 0px)/;

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

  test('a press moved a few pixels lifts the tab', async ({ desktop }) => {
    const { page } = desktop;
    await pressAndNudge(page, tab(page, /alpha/));
    await expect.poll(() => transformOf(tab(page, /alpha/))).toMatch(LIFTED);
    await page.mouse.up();
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

test.describe("Choosing another repository's tab", () => {
  test.use({ repo: { name: 'repo-alpha' } });

  let otherRepo: string;
  test.beforeEach(async ({ desktop }) => {
    otherRepo = createTestRepo({ name: 'repo-beta' });
    await createWorktree(desktop.page, 'alpha-work');
    await switchRepo(desktop.page, otherRepo);
    await createWorktree(desktop.page, 'beta-work');
  });
  test.afterEach(() => cleanupTestRepo(otherRepo));

  test('a press opens its repository, and a press moved a few pixels still lifts it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await expect(tab(page, /^repo-alpha\/alpha-work/)).toBeVisible();
    await pressAndNudge(page, tab(page, /alpha-work/));
    // Chosen and at home in its repository before the button comes up:
    // it has lost the repository prefix.
    const alpha = tab(page, /^alpha-work/);
    await expect(alpha).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => transformOf(alpha)).toMatch(LIFTED);
    await page.mouse.up();
  });

  test('pressed and carried, it opens its repository and drops where it is carried', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await carryOver(page, tab(page, /alpha-work/), tab(page, /beta-work/));
    await expect(tab(page, /^alpha-work/)).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await page.mouse.up();
    await expect
      .poll(() => tabNames(page))
      .toEqual(['repo-beta/beta-work', 'alpha-work']);
  });
});
