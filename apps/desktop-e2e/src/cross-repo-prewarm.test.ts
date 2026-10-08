import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { seedRepoConfig } from './fixtures/seed-home.js';
import { createWorktree, switchRepo, tab } from './setup/app.js';
import { letHostTimePass } from './setup/host-time.js';
import { fakeGhProjectConfig } from './setup/fake-gh.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * Another repository's tab is held ready like any other: resting the
 * pointer on it renders its pane against that repository, and pressing
 * it shows that same pane while its repository opens. A hover asks the
 * host to bring that repository up to date only once what it holds is
 * older than the parked TTL (an hour; `N10_PARKED_TTL_MS` here).
 */

const PARKED_TTL_MS = 8_000;

async function restOn(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('not laid out');
  await page.mouse.move(5, 5);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 4,
  });
}

/** The pane held ready, marked so the pane shown later can be told to
 *  be the same element. */
async function markSpare(page: Page): Promise<void> {
  await page.evaluate(() => {
    const spare = document.querySelector<HTMLElement>('[data-spare-pane]');
    if (spare) spare.dataset.heldReady = 'yes';
  });
}

/**
 * Watch the editor from now on: whether any frame showed the notice for
 * a repository that is not open, or no pane at all.
 */
async function watchEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { editorGaps: string[] };
    w.editorGaps = [];
    const panes = document.querySelector('[data-editor-panes]');
    if (!panes) throw new Error('no editor');
    const look = () => {
      if (panes.textContent?.includes('This tab belongs to'))
        w.editorGaps.push('notice');
      const shown = Array.from(panes.children).some(
        (el) =>
          !el.hasAttribute('data-spare-pane') &&
          (el as HTMLElement).childElementCount > 0
      );
      if (!shown) w.editorGaps.push('blank');
    };
    new MutationObserver(look).observe(panes, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}

const editorGaps = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { editorGaps: string[] }).editorGaps
  );

test.describe("Another repository's tab", () => {
  test.use({ repo: { name: 'repo-alpha' } });

  let otherRepo: string;
  test.beforeEach(async ({ desktop }) => {
    otherRepo = createTestRepo({ name: 'repo-beta' });
    await createWorktree(desktop.page, 'alpha-work');
    await switchRepo(desktop.page, otherRepo);
    await createWorktree(desktop.page, 'beta-work');
  });
  test.afterEach(() => cleanupTestRepo(otherRepo));

  test('resting on it holds its pane, and pressing it shows that pane with no notice or blank frame', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const alpha = tab(page, /^repo-alpha\/alpha-work/);
    await expect(alpha).toBeVisible();
    // Off the strip's left-last spare first: the hover is what holds it.
    await tab(page, /^beta-work/).click();
    await restOn(page, alpha);
    const spare = page.locator('[data-spare-pane]');
    await expect(spare).toContainText('alpha-work');
    await markSpare(page);
    await watchEditor(page);

    await page.mouse.down();
    await page.mouse.up();
    // At home in its repository: the tab lost its repository prefix.
    await expect(tab(page, /^alpha-work/)).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect
      .poll(() => page.evaluate(() => window.n10.getRepo().then((r) => r?.cwd)))
      .toContain('repo-alpha');
    const shown = page.locator('[data-editor-panes] > :not([data-spare-pane])');
    await expect(shown).toHaveCount(1);
    await expect(shown).toHaveAttribute('data-held-ready', 'yes');
    expect(await editorGaps(page)).toEqual([]);

    // Back the other way: the tab left is the one held now.
    await watchEditor(page);
    await tab(page, /^repo-beta\/beta-work/).click();
    await expect(tab(page, /^beta-work/)).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(await editorGaps(page)).toEqual([]);
  });

  test('switching back and forth leaves one status bar and one palette, for the open repository', async ({
    desktop,
  }) => {
    const { page } = desktop;
    for (let n = 0; n < 3; n++) {
      await tab(page, /^repo-alpha\/alpha-work/).click();
      await expect(tab(page, /^alpha-work/)).toHaveAttribute(
        'aria-selected',
        'true'
      );
      await tab(page, /^repo-beta\/beta-work/).click();
      await expect(tab(page, /^beta-work/)).toHaveAttribute(
        'aria-selected',
        'true'
      );
    }
    const statusBar = page.getByRole('contentinfo');
    await expect(statusBar).toHaveCount(1);
    await expect(statusBar).toContainText('repo-beta');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toHaveCount(1);
  });
});

test.describe("A hover over another repository's tab", () => {
  test.use({
    repo: { name: 'repo-alpha' },
    fakeGitHub: { prs: [] },
    // A list goes stale in a second while its repository is open, so
    // only the parked rule keeps a parked one from being read again.
    n10Config: { prPollInterval: 1_000 },
    env: { N10_PARKED_TTL_MS: String(PARKED_TTL_MS) },
  });

  let otherRepo: string;
  test.beforeEach(async ({ desktop }) => {
    otherRepo = createTestRepo({ name: 'repo-beta' });
    seedRepoConfig(
      desktop.homeDir,
      otherRepo,
      fakeGhProjectConfig({ prs: [], repo: 'beta' })
    );
    await switchRepo(desktop.page, otherRepo);
    await createWorktree(desktop.page, 'beta-work');
    await expect.poll(() => listedAt(desktop.page, otherRepo)).not.toBeNull();
    await switchRepo(desktop.page, desktop.repoPath);
    await createWorktree(desktop.page, 'alpha-work');
  });
  test.afterEach(() => cleanupTestRepo(otherRepo));

  const syncOf = (page: Page, repo: string) =>
    page.evaluate((cwd) => window.n10.getSyncState(cwd), repo);
  const listedAt = (page: Page, repo: string) =>
    syncOf(page, repo).then((s) => s.lastRemoteSyncAt);

  test('reads nothing while what is held is warm, and refreshes it once it is older than the parked TTL', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const beta = tab(page, /^repo-beta\/beta-work/);
    const before = await listedAt(page, otherRepo);

    await restOn(page, beta);
    await expect(page.locator('[data-spare-pane]')).toContainText('beta-work');
    // The pane's rows are the read that applies the parked rule; one
    // more, awaited, has certainly asked. A refresh it started would
    // still be out, or have landed.
    await page.evaluate((cwd) => window.n10.getSidebarModel(cwd), otherRepo);
    expect(await syncOf(page, otherRepo)).toMatchObject({
      lastRemoteSyncAt: before,
      remoteSyncing: false,
    });

    await page.mouse.move(5, 5);
    await letHostTimePass(page, PARKED_TTL_MS);
    await restOn(page, beta);
    await expect
      .poll(() => listedAt(page, otherRepo), { timeout: 10_000 })
      .toBeGreaterThan(before ?? 0);
  });
});
