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
  expect(labels.map((label) => label.match(/alpha|beta|gamma/)?.[0])).toEqual([
    'alpha',
    'beta',
    'gamma',
  ]);
  await all.getByRole('button', { name: /beta/ }).click();
  await expect(tab(page, /beta/)).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute('data-tab-id'))
    )
    .toBe(await tab(page, /beta/).getAttribute('data-tab-id'));
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
    const left = page.getByRole('button', { name: 'Scroll tabs left' });
    await expect(left).toHaveAttribute('aria-disabled', 'true');
    await expect(right).toHaveAttribute('aria-disabled', 'false');
    await expect(page.getByRole('button', { name: 'All tabs' })).toBeVisible();
    const before = await strip.evaluate((el) => el.scrollLeft);
    await right.click();
    await expect
      .poll(() => strip.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(before);
    await expect(left).toHaveAttribute('aria-disabled', 'false');
    await strip.evaluate((el) => {
      el.scrollLeft = el.scrollWidth - el.clientWidth - 120;
    });
    await right.focus();
    await right.click();
    await expect(right).toHaveAttribute('aria-disabled', 'true');
    await expect(right).toBeFocused();
  });
});
