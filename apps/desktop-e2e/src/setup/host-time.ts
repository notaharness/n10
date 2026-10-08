import type { Page } from '@playwright/test';

/**
 * Let `ms` of real time pass for the host. Its timers and TTLs run on
 * the host process's clock, which `page.clock` does not reach, so a
 * test that has to cross one waits it out; nothing on the page says
 * when it has passed.
 */
export async function letHostTimePass(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}
