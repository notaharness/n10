import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { showChanges, sidebarRow } from './setup/app.js';
import { updateFakeGh, type FakeGitHub } from './setup/fake-gh.js';
import { commitOnBranch, diffText, git } from './setup/pr-diff.js';

/**
 * A pull request's diff is read at the commit the provider says is its
 * head — not at whatever the local branch points to. How it stays there
 * as the pull request moves is `pr-diff-moves.test.ts`.
 *
 * The fake `gh` reports the branch's real tip unless a test names
 * another head, so each case below moves the branch or the reported
 * head apart on purpose.
 */

const BRANCH = 'exact-head';

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [{ number: 12, title: 'Exact head', headRefName: BRANCH }],
};

test.use({
  fakeGitHub: GITHUB,
  repo: {
    worktrees: [{ branch: BRANCH, files: { 'notes.txt': 'first version\n' } }],
  },
});

/** The pull request, from its Overview on to its changes. */
async function openPr(page: Page) {
  await sidebarRow(page, /Exact head|#12/)
    .first()
    .click();
  await showChanges(page);
}

test('reads the pull request’s head, not a local commit made after it', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const pushed = git(repoPath, 'rev-parse', BRANCH);
  updateFakeGh(homeDir, (s) => {
    s.prs[0].headRefOid = pushed;
  });
  // Committed locally, never pushed: not part of the pull request.
  commitOnBranch(repoPath, BRANCH, 'unpushed version\n');

  await openPr(page);
  await expect(diffText(page, 'first version')).toBeVisible({
    timeout: 30_000,
  });
  await expect(diffText(page, 'unpushed version')).toHaveCount(0);
});

test('names the commits it compares', async ({ desktop }) => {
  const { page, repoPath } = desktop;
  const head = git(repoPath, 'rev-parse', BRANCH);
  const base = git(repoPath, 'merge-base', 'main', BRANCH);

  await openPr(page);
  const identity = page.getByTestId('diff-comparison');
  await expect(identity).toHaveText(
    `${base.slice(0, 7)} → ${head.slice(0, 7)}`,
    { timeout: 30_000 }
  );
  await identity.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText(`Head${head.slice(0, 7)}`);
  await expect(tooltip).toContainText('where it left main');
});

test.describe('a head the clone does not have', () => {
  test.use({
    fakeGitHub: {
      ...GITHUB,
      prs: [{ ...GITHUB.prs[0]!, headRefOid: 'e'.repeat(40) }],
    },
  });

  test('is an error that says what the clone has, never the branch’s diff', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    const local = git(repoPath, 'rev-parse', BRANCH).slice(0, 7);

    await openPr(page);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(
      "The pull request's head eeeeeee is not in this clone",
      { timeout: 30_000 }
    );
    await expect(alert).toContainText(`${BRANCH} is at ${local}`);
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(diffText(page, 'first version')).toHaveCount(0);
    await expect(page.getByText(/No changes between/)).toHaveCount(0);
  });
});

test.describe('a head only the remote has', () => {
  test.use({ n10Config: { prPollInterval: 1_000 } });

  test('loads on Retry once the remote answers', async ({ desktop }) => {
    const { page, repoPath, homeDir } = desktop;
    // A push made from another clone: its commit is on the remote only.
    const remote = test.info().outputPath('upstream.git');
    const other = test.info().outputPath('other-clone');
    git(repoPath, 'clone', '-q', '--bare', repoPath, remote);
    git(repoPath, 'clone', '-q', '-b', BRANCH, remote, other);
    writeFileSync(join(other, 'notes.txt'), 'pushed version\n');
    git(
      other,
      '-c',
      'user.name=n10',
      '-c',
      'user.email=e2e@n10.dev',
      'commit',
      '-q',
      '-am',
      'pushed'
    );
    git(other, 'push', '-q', 'origin', BRANCH);
    const pushed = git(other, 'rev-parse', 'HEAD');

    // This clone's origin cannot be reached yet.
    git(
      repoPath,
      'remote',
      'add',
      'origin',
      test.info().outputPath('gone.git')
    );
    updateFakeGh(homeDir, (s) => {
      s.prs[0]!.headRefOid = pushed;
      s.prs[0]!.title = 'Exact head, pushed';
    });
    const row = sidebarRow(page, /Exact head, pushed/);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await showChanges(page);
    const failure = page
      .getByRole('alert')
      .filter({ hasText: "Couldn't load the diff" });
    await expect(failure).toContainText('fetching it failed', {
      timeout: 30_000,
    });

    git(repoPath, 'remote', 'set-url', 'origin', remote);
    await failure.getByRole('button', { name: /^Retry/ }).click();
    await expect(diffText(page, 'pushed version')).toBeVisible({
      timeout: 30_000,
    });
    await expect(failure).toHaveCount(0);
  });
});
