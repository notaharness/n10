import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, switchRepo, tab } from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * The tab strip, pixel for pixel in the pinned container (see
 * `visual.test.ts`): tabs of two repositories, each with its colour
 * along the bottom, wrapped onto a second row or scrolled in one; a
 * long branch cut from the front; and the close button over the end of
 * a hovered tab. The strip alone is in shot: the window around it is
 * covered by the other visual tests.
 */

const shot = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixels: 0,
} as const;

const HOME = [
  'feature-tab-strip-keeps-the-end-in-view',
  'fix-login-loop',
  'docs',
];
const OTHER = ['beam-relay-backoff', 'beam-passkey-ceremony'];

/** Two repositories' tabs in a window narrow enough to overflow, the
 *  last one opened active, and nothing hovered. */
async function twoReposOfTabs(
  page: Page,
  app: ElectronApplication,
  other: string
) {
  await size(app);
  for (const branch of HOME) await createWorktree(page, branch);
  await switchRepo(page, other);
  for (const branch of OTHER) await createWorktree(page, branch);
  await page.mouse.move(600, 500);
}

function size(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.setMinimumSize(0, 0);
    window.setContentSize(1000, 600);
  });
}

const strip = (page: Page) => page.getByRole('tablist', { name: 'Open tabs' });

test.describe('Visual (tab strip) @visual', () => {
  test.use({ repo: { name: 'n10-visual' } });

  let other: string;
  test.beforeEach(() => {
    other = createTestRepo({ name: 'beam' });
  });
  test.afterEach(() => cleanupTestRepo(other));

  test.describe('light', () => {
    test.use({ desktopPrefs: { theme: 'light', nativeFrame: false } });

    test('tabs of two repositories wrapped onto a second row', async ({
      desktop,
    }) => {
      const { page, app } = desktop;
      await twoReposOfTabs(page, app, other);
      await expect(strip(page)).toHaveScreenshot('tab-strip-wrap.png', shot);
    });
  });

  test.describe('light, scrolled', () => {
    test.use({
      desktopPrefs: {
        theme: 'light',
        nativeFrame: false,
        tabOverflow: 'scroll',
      },
    });

    test('tabs of two repositories in one row', async ({ desktop }) => {
      const { page, app } = desktop;
      await twoReposOfTabs(page, app, other);
      await expect(strip(page)).toHaveScreenshot('tab-strip-scroll.png', shot);
    });
  });

  test.describe('dark', () => {
    test.use({ desktopPrefs: { theme: 'dark', nativeFrame: false } });

    test('the close button over the end of a hovered tab', async ({
      desktop,
    }) => {
      const { page, app } = desktop;
      await twoReposOfTabs(page, app, other);
      await tab(page, /fix-login-loop/).hover();
      await expect(strip(page)).toHaveScreenshot(
        'tab-strip-hover-dark.png',
        shot
      );
    });
  });
});
