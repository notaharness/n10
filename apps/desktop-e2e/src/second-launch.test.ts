import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { newWorktreeButton } from './setup/app.js';
import { armFolderPick } from './setup/dialogs.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import { clickAppMenuItem } from './setup/menu.js';

/**
 * n10 runs one instance. Launching it again, from a shell in another
 * repository, starts a real second Electron process on the same
 * userData: it loses the single-instance lock, hands the running app
 * the directory it was started for, and quits. The running window
 * then opens that repository, from the workspace and from the start
 * screen alike, as File › Open Repository does.
 */

/** The repository open once the workspace names `cwd`. */
async function openedRepo(page: Page, cwd: string): Promise<string | null> {
  await newWorktreeButton(page).waitFor({ timeout: 30_000 });
  await page
    .getByText(basename(cwd), { exact: true })
    .first()
    .waitFor({ timeout: 30_000 });
  return (await page.evaluate(() => window.n10.getRepo()))?.cwd ?? null;
}

/** When `cwd` was last opened, per the recents list. */
async function lastOpenedAt(page: Page, cwd: string): Promise<number> {
  const recents = await page.evaluate(() => window.n10.listRecentRepos());
  const entry = recents.find((r) => r.cwd === cwd);
  if (!entry) throw new Error(`${cwd} is not among the recents`);
  return entry.lastOpenedAt;
}

let otherRepo: string;

test.beforeEach(() => {
  otherRepo = createTestRepo({ name: 'repo-other' });
});

test.afterEach(() => {
  cleanupTestRepo(otherRepo);
});

test.describe('With a repository open', () => {
  test('a second launch opens the repository it was started in', async ({
    desktop,
  }) => {
    await desktop.launchAgain(otherRepo);

    expect(await openedRepo(desktop.page, otherRepo)).toBe(otherRepo);
  });

  test('a second launch from the repository open leaves it as it is', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    const opened = await lastOpenedAt(page, repoPath);

    await desktop.launchAgain(repoPath);
    // Launches are answered in order, so once this one has opened its
    // repository the first has been answered too.
    await desktop.launchAgain(otherRepo);
    expect(await openedRepo(page, otherRepo)).toBe(otherRepo);

    expect(await lastOpenedAt(page, repoPath)).toBe(opened);
  });

  test('a launch while no page is listening opens once one is', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    // What a reload or a recovering renderer looks like from main: the
    // window's page is gone, so there is nobody to send the launch to.
    const url = page.url();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.loadURL('about:blank')
    );

    await desktop.launchAgain(otherRepo);
    await app.evaluate(
      ({ BrowserWindow }, back) =>
        BrowserWindow.getAllWindows()[0]?.loadURL(back),
      url
    );

    expect(await openedRepo(page, otherRepo)).toBe(otherRepo);
  });

  test('File › Open Repository opens the picked folder', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await armFolderPick(app, otherRepo);
    await clickAppMenuItem(app, 'Open Repository…');

    expect(await openedRepo(page, otherRepo)).toBe(otherRepo);
  });
});

test.describe('On the start screen', () => {
  test.use({ startWithoutRepo: true });

  test('a second launch opens the repository it was started in', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await expect(
      page.getByRole('button', { name: /Open repository/ })
    ).toBeVisible({ timeout: 30_000 });

    await desktop.launchAgain(otherRepo);

    expect(await openedRepo(page, otherRepo)).toBe(otherRepo);
  });

  test('File › Open Repository opens the picked folder', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await expect(
      page.getByRole('button', { name: /Open repository/ })
    ).toBeVisible({ timeout: 30_000 });

    await armFolderPick(app, otherRepo);
    await clickAppMenuItem(app, 'Open Repository…');

    expect(await openedRepo(page, otherRepo)).toBe(otherRepo);
  });
});
