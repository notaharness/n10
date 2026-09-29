import type { Page } from '@playwright/test';

/**
 * Let time pass with the pointer where it is. For a test of what
 * resting the pointer does (the editor renders a tab it rests on after
 * a wait), where the time itself is the stimulus and there is no event
 * to wait for instead. The lint rule against fixed waits is off for
 * this file alone (`eslint.config.mjs`).
 */
export async function linger(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}
