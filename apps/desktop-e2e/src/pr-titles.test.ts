import { test, expect } from './fixtures/desktop.js';
import { sidebarRow, switchRepo, tab } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * A worktree with a pull request is called by the pull request's title
 * — in the sidebar, where the branch moves to the second line, and on
 * its tab, where the title survives the item going out of reach: after
 * a switch to another repository the tab still reads by its title,
 * prefixed with the repo it belongs to, rather than turning back into a
 * branch slug or a number.
 */

const ALPHA = 'repo-alpha';
const BRANCH = 'feature-undo';
const TITLE = 'Add undo support';

const GITHUB: FakeGitHub = {
  prs: [{ number: 42, title: TITLE, headRefName: BRANCH }],
};

test.use({
  fakeGitHub: GITHUB,
  repo: { name: ALPHA, worktrees: [{ branch: BRANCH }] },
});

test.describe('Pull request titles', () => {
  let otherRepo: string;

  test.beforeEach(() => {
    otherRepo = createTestRepo({ name: 'repo-beta' });
  });

  test.afterEach(() => {
    cleanupTestRepo(otherRepo);
  });

  test('name the row and the tab, and outlive a repository switch', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    // The row leads with the title; the branch is the detail line.
    const row = sidebarRow(page, new RegExp(TITLE));
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator('span.truncate').first()).toHaveText(TITLE);
    await expect(row).toContainText(BRANCH);

    await row.click();
    const own = tab(page, new RegExp(`^\\s*${TITLE}`));
    await expect(own).toBeVisible();
    await expect(tab(page, new RegExp(`^\\s*${BRANCH}`))).toHaveCount(0);

    // Out of reach: beta's sidebar has no row for it, and the tab keeps
    // its title all the same.
    await switchRepo(page, otherRepo);
    const foreign = tab(page, new RegExp(`${ALPHA}\\s*/\\s*${TITLE}`));
    await expect(foreign).toBeVisible();
    await expect(tab(page, /42\s*$/)).toHaveCount(0);
    await expect(tab(page, new RegExp(BRANCH))).toHaveCount(0);

    // And back.
    await foreign.click();
    await expect
      .poll(() => page.evaluate(() => window.n10.getRepo()), {
        timeout: 30_000,
      })
      .toMatchObject({ cwd: repoPath });
    await expect(own).toBeVisible();
  });
});
