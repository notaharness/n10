import { test, expect } from './fixtures/desktop.js';
import { createWorktree, tab } from './setup/app.js';

test('All tabs lists grouped tabs in strip order and jumps to one', async ({
  desktop,
}) => {
  const { page } = desktop;
  for (const name of ['alpha', 'beta', 'gamma'])
    await createWorktree(page, name);
  await page.getByRole('button', { name: 'All tabs' }).click();
  const all = page.getByRole('dialog', { name: 'All tabs' });
  await expect(all.locator('[data-roster-row]')).toHaveCount(3);
  const labels = await all.locator('[data-roster-row]').allTextContents();
  expect(labels).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/alpha/),
      expect.stringMatching(/beta/),
      expect.stringMatching(/gamma/),
    ])
  );
  await all.getByRole('button', { name: /beta/ }).click();
  await expect(tab(page, /beta/)).toHaveAttribute('aria-selected', 'true');
});

test.describe('scroll strip controls', () => {
  test.use({ desktopPrefs: { tabOverflow: 'scroll' } });
  test('shows fixed All tabs and working scroll arrows when tabs overflow', async ({
    desktop,
  }) => {
    const { page } = desktop;
    for (let i = 0; i < 10; i++)
      await createWorktree(page, `feature-${i}-long-branch-name`);
    const strip = page.getByRole('tablist', { name: 'Open tabs' });
    await expect(strip).toHaveAttribute('data-overflow', 'scroll');
    const firstTab = strip.locator('[data-tab-id]').first();
    await expect
      .poll(() => firstTab.evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(215);
    const right = page.getByRole('button', { name: 'Scroll tabs right' });
    await expect(right).toBeEnabled();
    await expect(page.getByRole('button', { name: 'All tabs' })).toBeVisible();
    const before = await strip.evaluate((el) => el.scrollLeft);
    await right.click();
    await expect
      .poll(() => strip.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(before);
  });
});
