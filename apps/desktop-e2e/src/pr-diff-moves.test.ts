import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { showChanges, sidebarRow, tab, tabs } from './setup/app.js';
import { updateFakeGh, type FakeGitHub } from './setup/fake-gh.js';
import {
  commitOnBranch,
  commitWithoutCheckout,
  diffText,
  git,
} from './setup/pr-diff.js';

/**
 * A pull request's diff stays at the revision the reader opened as the
 * pull request moves under it — a push, a retarget, a tab closed or in
 * the background — and moves only when the reader loads the new one,
 * or when nothing was ever shown there to keep.
 */

const BRANCH = 'exact-head';

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [{ number: 12, title: 'Exact head', headRefName: BRANCH }],
};

test.use({ fakeGitHub: GITHUB });

/** The pull request, from its Overview on to its changes. */
async function openPr(page: Page) {
  await sidebarRow(page, /Exact head|#12/)
    .first()
    .click();
  await showChanges(page);
}

test.describe('when the pull request moves', () => {
  // The list re-reads GitHub every second, so a push is noticed inside
  // the test rather than after a minute.
  test.use({
    n10Config: { prPollInterval: 1_000 },
    repo: {
      worktrees: [
        { branch: BRANCH, files: { 'notes.txt': 'first version\n' } },
        { branch: 'elsewhere', files: { 'other.txt': 'other\n' } },
      ],
    },
  });

  test('keeps its head when its tab is closed and opened again', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    await openPr(page);
    await expect(diffText(page, 'first version')).toBeVisible({
      timeout: 30_000,
    });
    commitOnBranch(repoPath, BRANCH, 'second version\n');
    const banner = page.getByRole('status', { name: 'New commits' });
    await expect(banner).toBeVisible({ timeout: 30_000 });

    // Another preview replaces this tab. Opened again — with the list
    // already at the new head — it comes back where the reader left it,
    // the new commits offered rather than swapped in.
    await sidebarRow(page, /elsewhere/).click();
    await expect(page.getByText('other.txt').first()).toBeVisible({
      timeout: 30_000,
    });
    await openPr(page);
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(diffText(page, 'first version')).toBeVisible();
    await expect(diffText(page, 'second version')).toHaveCount(0);
  });

  test('keeps the diff on screen and loads the new head on request', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    const first = git(repoPath, 'rev-parse', BRANCH);

    await openPr(page);
    await expect(diffText(page, 'first version')).toBeVisible({
      timeout: 30_000,
    });

    const second = commitOnBranch(repoPath, BRANCH, 'second version\n');
    const banner = page.getByRole('status', { name: 'New commits' });
    await expect(banner).toContainText(
      `The pull request moved to ${second.slice(
        0,
        7
      )}. You are reading ${first.slice(0, 7)}.`,
      { timeout: 30_000 }
    );
    // Still the diff the reader was reading.
    await expect(diffText(page, 'first version')).toBeVisible();
    await expect(diffText(page, 'second version')).toHaveCount(0);

    // By keyboard: the button goes with its banner, and focus lands on
    // the comparison it loaded, not the page.
    await banner.getByRole('button', { name: 'Load new commits' }).focus();
    await page.keyboard.press('Enter');
    await expect(diffText(page, 'second version')).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId('diff-comparison')).toContainText(
      second.slice(0, 7)
    );
    await expect(page.getByTestId('diff-comparison')).toBeFocused();
  });
  test('keeps the diff when the new head cannot be read', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await openPr(page);
    await expect(diffText(page, 'first version')).toBeVisible({
      timeout: 30_000,
    });

    // A push this clone cannot fetch.
    updateFakeGh(homeDir, (s) => {
      s.prs[0]!.headRefOid = 'e'.repeat(40);
    });
    const banner = page.getByRole('status', { name: 'New commits' });
    await banner.getByRole('button', { name: 'Load new commits' }).click({
      timeout: 30_000,
    });
    await expect(banner).toContainText(
      "Couldn't load it: The pull request's head eeeeeee is not in this clone"
    );
    await expect(diffText(page, 'first version')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('keeps its base when retargeted, until asked to compare', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await openPr(page);
    await expect(diffText(page, 'first version')).toBeVisible({
      timeout: 30_000,
    });

    // Retargeted onto a branch that already holds its commits, as a
    // stacked pull request is when its parent's branch moves on.
    git(repoPath, 'branch', 'release', BRANCH);
    updateFakeGh(homeDir, (s) => {
      s.prs[0]!.baseRefName = 'release';
    });
    const banner = page.getByRole('status', { name: 'New target' });
    await expect(banner).toContainText(
      'The pull request now targets release. You are reading it against main.',
      { timeout: 30_000 }
    );
    await expect(diffText(page, 'first version')).toBeVisible();

    await banner.getByRole('button', { name: 'Compare with release' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(`No changes between release and ${BRANCH}.`)
    ).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId('diff-comparison')).toBeFocused();
  });
});

test.describe('when it moves while another pull request is in front', () => {
  test.use({
    n10Config: { prPollInterval: 1_000 },
    fakeGitHub: {
      ...GITHUB,
      prs: [
        ...GITHUB.prs,
        { number: 13, title: 'Other change', headRefName: 'other-change' },
      ],
    },
    repo: {
      worktrees: [
        {
          branch: BRANCH,
          files: { 'notes.txt': 'first version\n' },
          removeWorktree: true,
        },
        {
          branch: 'other-change',
          files: { 'other.txt': 'other change\n' },
          removeWorktree: true,
        },
      ],
    },
  });

  test('keeps its head in the background tab', async ({ desktop }) => {
    const { page, repoPath, homeDir } = desktop;
    // Both kept open (a double-click keeps a preview tab). Neither has
    // a checkout, so neither has a session: the tab behind unmounts its
    // pane until it is in front again.
    await sidebarRow(page, /Exact head/).click();
    await showChanges(page);
    await tab(page, /Exact head/).dblclick();
    await expect(diffText(page, 'first version')).toBeVisible({
      timeout: 30_000,
    });
    await sidebarRow(page, /Other change/).click();
    await showChanges(page);
    await tab(page, /Other change/).dblclick();
    await expect(diffText(page, 'other change')).toBeVisible({
      timeout: 30_000,
    });

    // Pushed while its tab is behind. The retitle rides in the same
    // list as the new head, so the sidebar showing it means the app
    // knows the head before the tab comes back.
    commitWithoutCheckout(repoPath, BRANCH, 'second version\n');
    updateFakeGh(homeDir, (s) => {
      s.prs[0]!.title = 'Exact head, pushed';
    });
    await expect(sidebarRow(page, /Exact head, pushed/)).toBeVisible({
      timeout: 30_000,
    });

    await tab(page, /Exact head/).click();
    await expect(page.getByRole('status', { name: 'New commits' })).toBeVisible(
      { timeout: 30_000 }
    );
    await expect(diffText(page, 'first version')).toBeVisible();
    await expect(diffText(page, 'second version')).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(2);
  });
});
