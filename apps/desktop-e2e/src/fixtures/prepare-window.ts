import type { ElectronApplication, Page } from '@playwright/test';

/** Identical readiness and diagnostics for the initial window and every restart. */
export async function prepareWindow(
  app: ElectronApplication,
  startWithoutRepo: boolean | undefined,
  pageErrors: string[],
  consoleErrors: string[]
): Promise<Page> {
  const page = await app.firstWindow();
  page.on('pageerror', (err) =>
    pageErrors.push(err.stack || err.message || String(err))
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  // Xvfb can leave Chromium occluded; actionability needs unthrottled frames.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.webContents.setBackgroundThrottling(false);
    win.show();
    win.focus();
  });
  await page.waitForLoadState('domcontentloaded');
  if (!startWithoutRepo) {
    await page
      .getByRole('button', { name: 'New worktree', exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }
  return page;
}
