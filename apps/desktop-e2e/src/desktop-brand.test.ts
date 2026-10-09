import { test, expect } from './fixtures/desktop.js';

for (const theme of ['light', 'dark'] as const) {
  test.describe(`desktop mark in ${theme} theme`, () => {
    test.use({ desktopPrefs: { theme, nativeFrame: false }, repo: { name: 'n10-brand' } });

    test('renders in the title bar at 1600x900', async ({ desktop }, testInfo) => {
      await desktop.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900);
      });
      const mark = desktop.page.getByTestId('titlebar-logo');
      await expect(mark).toBeVisible();
      await expect(mark).toHaveAttribute('alt', '');
      await expect(mark).toHaveAttribute('aria-hidden', 'true');
      await expect
        .poll(() => mark.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      const box = await mark.boundingBox();
      expect(box?.width).toBe(32);
      expect(box?.height).toBe(32);
      await desktop.page.screenshot({
        path: testInfo.outputPath(`titlebar-${theme}-1600x900.png`),
        animations: 'disabled',
        caret: 'hide',
      });
    });
  });
}
