import { expect, type Page } from '@playwright/test';
import { sidebarRow } from './app.js';
import { addExternalWorktree } from './external.js';

/**
 * Has discovery scan again, and waits for it: a worktree added from
 * outside reaches the renderer only through a scan's announcement.
 * Scans run one at a time, so whatever an earlier change would make a
 * scan do has been done by the time this returns.
 */
export async function rescan(page: Page, repoPath: string): Promise<void> {
  await page.evaluate(() => {
    const w = window as { discoveryEvents?: number };
    w.discoveryEvents = 0;
    window.n10.onDiscoveryChanged(() => {
      w.discoveryEvents = (w.discoveryEvents ?? 0) + 1;
    });
  });
  addExternalWorktree(repoPath, 'rescanned');
  await expect(sidebarRow(page, 'rescanned')).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as { discoveryEvents?: number }).discoveryEvents
      )
    )
    .toBeGreaterThan(0);
}
