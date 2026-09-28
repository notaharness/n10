import { basename } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
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

/** The repository the host has open, asked through the window's page
 *  from main, so it works while Playwright's own handle on the page is
 *  stuck or dead. Null while the renderer is gone. */
function hostRepo(app: ElectronApplication): Promise<string | null> {
  return app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    if (!contents || contents.isCrashed()) return null;
    return contents.executeJavaScript(
      'window.n10.getRepo().then((r) => r && r.cwd)'
    ) as Promise<string | null>;
  });
}

/**
 * Wait until the window's page shows the workspace, and so has claimed
 * launches. The gate claims in the commit that first renders it (a
 * store update, whose effects React flushes with the commit), and a
 * round trip made after that is answered after the claim.
 */
async function pageClaimed(
  app: ElectronApplication,
  cwd: string
): Promise<void> {
  const shown = () =>
    app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!contents || contents.isCrashed()) return '';
      return contents.executeJavaScript(
        'document.body.innerText'
      ) as Promise<string>;
    });
  await expect.poll(shown, { timeout: 30_000 }).toContain('New worktree');
  expect(await hostRepo(app)).toBe(cwd);
}

/** Kill the window's renderer the way the OS does, and wait for main
 *  to register the death. */
async function crashRenderer(app: ElectronApplication): Promise<void> {
  const deaths = () =>
    app.evaluate(() => (globalThis as { deaths?: number }).deaths ?? 0);
  const before = await deaths();
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    const g = globalThis as { deaths?: number; counting?: boolean };
    if (contents && !g.counting) {
      g.counting = true;
      contents.on('render-process-gone', () => {
        g.deaths = (g.deaths ?? 0) + 1;
      });
    }
    const pid = contents?.getOSProcessId();
    if (pid) process.kill(pid, 'SIGKILL');
  });
  await expect.poll(deaths, { timeout: 15_000 }).toBeGreaterThan(before);
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

  test('a navigation the window refuses leaves the page listening', async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;
    await pageClaimed(app, repoPath);
    // An off-site link outside ExternalAnchor: main refuses it in
    // will-navigate and hands it to the browser, which is stubbed here.
    await app.evaluate(({ shell }) => {
      const g = globalThis as { refused?: string[] };
      g.refused = [];
      (shell as { openExternal: unknown }).openExternal = (url: string) => {
        g.refused?.push(url);
        return Promise.resolve();
      };
    });
    await page.evaluate(() => {
      window.location.href = 'https://example.invalid/';
    });
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { refused?: string[] }).refused)
      )
      .toEqual(['https://example.invalid/']);

    await desktop.launchAgain(otherRepo);

    // Playwright counts the refused navigation as still pending and
    // holds page-side waits for it.
    await expect.poll(() => hostRepo(app), { timeout: 30_000 }).toBe(otherRepo);
  });

  test('a launch while a crashed window waits on its question opens after the reload', async ({
    desktop,
  }) => {
    const { app, repoPath } = desktop;
    // renderer-recovery.ts reloads three deaths inside a minute and asks
    // about the fourth, leaving the dead page up; this test answers.
    await app.evaluate(({ dialog }) => {
      const g = globalThis as { answer?: (response: number) => void };
      (dialog as { showMessageBox: unknown }).showMessageBox = () =>
        new Promise((resolve) => {
          g.answer = (response) =>
            resolve({ response, checkboxChecked: false });
        });
    });
    for (let i = 0; i < 3; i += 1) {
      await pageClaimed(app, repoPath);
      await crashRenderer(app);
    }
    await pageClaimed(app, repoPath);
    await crashRenderer(app);
    await expect
      .poll(() => app.evaluate(() => 'answer' in globalThis))
      .toBe(true);

    await desktop.launchAgain(otherRepo);
    await app.evaluate(() =>
      (globalThis as { answer?: (response: number) => void }).answer?.(0)
    );

    await expect.poll(() => hostRepo(app), { timeout: 30_000 }).toBe(otherRepo);
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
