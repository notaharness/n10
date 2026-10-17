import type { ElectronApplication, Page } from '@playwright/test';

/**
 * Make a launched window ready for a test. Chromium throttles
 * requestAnimationFrame in a window it considers hidden or occluded, and
 * under xvfb (or behind another window on a developer's desktop) that is
 * the normal state. Playwright's actionability check waits for two
 * consecutive stable animation frames before it will click, so a
 * throttled window makes every click hang until the timeout even though
 * the page is perfectly idle. Show, focus and un-throttle before any
 * test touches it, and collect what the renderer reports as errors.
 */
export async function readyWindow(
  app: ElectronApplication,
  page: Page,
  startWithoutRepo: boolean | undefined,
  pageErrors: string[],
  consoleErrors: string[]
): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.webContents.setBackgroundThrottling(false);
    win.show();
    win.focus();
  });
  page.on('pageerror', (err) =>
    pageErrors.push(err.stack || err.message || String(err))
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.waitForLoadState('domcontentloaded');
  if (startWithoutRepo) return;
  // The workspace has rendered (not the repo picker, not a blank
  // window) once the sidebar's actions exist.
  await page
    .getByRole('button', { name: 'New worktree', exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
}
