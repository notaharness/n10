import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, stripTab, switchRepo } from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import { startLoneShells } from './setup/terminals.js';

/**
 * The tab strip, pixel for pixel in the pinned container (see
 * `visual.test.ts`): two repositories' chips, each with its colour
 * along the bottom, the active one reading `{group} / {member}` with a
 * long branch, and shells standing alone, wrapped onto a second row or
 * scrolled in one; and the close button over the end of a hovered tab.
 * The strip alone is in shot: the window around it is covered by the
 * other visual tests.
 */

const shot = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixels: 0,
} as const;

const HOME = ['fix-login-loop', 'docs'];
const OTHER = ['beam-relay-backoff', 'feature-tab-strip-keeps-the-end-in-view'];
const SHELLS = ['notes', 'scratch', 'release', 'bench', 'logs'];

/** Shells alone in their directories, one at a time so the strip
 *  takes them in this order. */
async function loneShells(page: Page, homeDir: string, names: string[]) {
  for (const name of names) {
    startLoneShells(homeDir, [name]);
    await expect(stripTab(page, new RegExp(name))).toBeVisible({
      timeout: 30_000,
    });
  }
}

/** Two repositories' chips, then lone shells, in a window narrow
 *  enough to overflow, the last worktree opened active, and nothing
 *  hovered. */
async function twoReposOfTabs(
  page: Page,
  app: ElectronApplication,
  homeDir: string,
  other: string
) {
  await size(app);
  for (const branch of HOME) await createWorktree(page, branch);
  await switchRepo(page, other);
  for (const branch of OTHER) await createWorktree(page, branch);
  await loneShells(page, homeDir, SHELLS);
  await page.mouse.move(600, 500);
}

function size(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.setMinimumSize(0, 0);
    window.setContentSize(1000, 600);
  });
}

/**
 * Hold `el` in `:hover` through DevTools rather than the pointer.
 * Chromium drops a pointer's hover once the page's style changes, and
 * Playwright's capture injects a stylesheet (to stop animations and
 * hide the caret), so a pointer hover does not survive into the shot.
 */
async function forceHover(page: Page, el: Locator): Promise<void> {
  await el.evaluate((node) => node.setAttribute('data-force-hover', ''));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-force-hover]',
  });
  await cdp.send('CSS.forcePseudoState', {
    nodeId,
    forcedPseudoClasses: ['hover'],
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
      const { page, app, homeDir } = desktop;
      await twoReposOfTabs(page, app, homeDir, other);
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
      const { page, app, homeDir } = desktop;
      await twoReposOfTabs(page, app, homeDir, other);
      await expect(strip(page)).toHaveScreenshot('tab-strip-scroll.png', shot);
      await expect(strip(page).locator('..')).toHaveScreenshot(
        'tab-strip-controls-scroll.png',
        shot
      );
      await page.getByRole('button', { name: 'All tabs' }).click();
      await expect(
        page.getByRole('dialog', { name: 'All tabs' })
      ).toHaveScreenshot('all-tabs-popover.png', shot);
    });
  });

  test.describe('dark', () => {
    test.use({ desktopPrefs: { theme: 'dark', nativeFrame: false } });

    test('the close button over the end of a hovered tab', async ({
      desktop,
    }) => {
      const { page, app, homeDir } = desktop;
      await twoReposOfTabs(page, app, homeDir, other);
      const hovered = stripTab(page, /scratch/);
      await forceHover(page, hovered);
      await expect(
        hovered.getByRole('button', { name: 'Close tab' }).locator('..')
      ).toHaveCSS('opacity', '1');
      await expect(strip(page)).toHaveScreenshot(
        'tab-strip-hover-dark.png',
        shot
      );
    });
  });
});
