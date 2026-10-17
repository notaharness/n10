import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { agentPicker, openPalette, sessionMenu } from './setup/app.js';

/**
 * Checking out a branch from the palette lands in its session menu, and
 * the whole trip is keyboard-only: Ctrl+K, the branch name, Enter, then
 * the menu holds focus — Tab stays inside it, the arrows change the
 * agent, Enter starts the session.
 */

const BRANCH = 'keyboard-only';

function focusInside(menu: Locator) {
  return menu.evaluate((element) => element.contains(document.activeElement));
}

async function openMenuFromPalette(page: Page): Promise<Locator> {
  const input = await openPalette(page);
  await input.pressSequentially(BRANCH);
  await expect(
    page.getByRole('option', { name: /Create branch\s*keyboard-only/ })
  ).toBeVisible();
  await page.keyboard.press('Enter');
  const menu = sessionMenu(page);
  await expect(menu).toBeVisible({ timeout: 30_000 });
  await expect(agentPicker(page)).toBeEnabled();
  return menu;
}

test('the session menu opened from the palette takes focus and keeps Tab inside', async ({
  desktop,
}) => {
  const { page } = desktop;
  const menu = await openMenuFromPalette(page);
  // The agent is the menu's one real choice, so it has focus first.
  await expect(agentPicker(page)).toBeFocused();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await focusInside(menu)).toBe(true);
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusInside(menu)).toBe(true);
  }
});

test('arrows change the agent and Enter starts the session', async ({
  desktop,
}) => {
  const { page } = desktop;
  await openMenuFromPalette(page);
  const picker = agentPicker(page);
  await expect(picker).toBeFocused();
  await expect(picker).toHaveText('Custom (default)');
  await page.keyboard.press('ArrowDown');
  await expect(picker).toHaveText('Claude');
  await expect(picker).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowUp');
  await expect(picker).toHaveText('Custom (default)');
  await page.keyboard.press('Enter');
  await expect(sessionMenu(page)).toBeHidden();
  await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
    timeout: 30_000,
  });
});
