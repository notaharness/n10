import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { showChanges, sidebarRow } from './setup/app.js';
import { updateFakeGh } from './setup/fake-gh.js';

/**
 * What a pull request's diff claims to hold is what the commits hold:
 * a change the reader's git config would hide still shows, and a diff
 * with nothing on screen is "no changes" only when there are none.
 */

const BRANCH = 'contents';

test.use({
  n10Config: { prPollInterval: 1_000 },
  fakeGitHub: {
    username: 'n10-tester',
    prs: [{ number: 21, title: 'Contents', headRefName: BRANCH }],
  },
  repo: {
    worktrees: [{ branch: BRANCH, files: { 'notes.txt': 'first version\n' } }],
  },
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const worktreeOf = (repoPath: string) =>
  join(repoPath, '.claude', 'worktrees', BRANCH);

/**
 * Push a commit to the pull request and wait until the app has the new
 * head: the retitle arrives in the same list, so the sidebar showing it
 * means the tab opens at the commit just made.
 */
async function pushAndOpen(page: Page, homeDir: string) {
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Contents, pushed';
  });
  const row = sidebarRow(page, /Contents, pushed/);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await showChanges(page);
}

const noChanges = (page: Page) => page.getByText(/No changes between/);

test('lists a submodule change the repository’s config hides', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const worktree = worktreeOf(repoPath);
  const pointer = git(repoPath, 'rev-parse', 'main');
  git(worktree, 'rm', '-q', 'notes.txt');
  git(
    worktree,
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${pointer},module`
  );
  git(worktree, 'commit', '-q', '-m', 'add a submodule');
  git(repoPath, 'config', 'diff.ignoreSubmodules', 'all');

  await pushAndOpen(page, homeDir);
  await expect(
    page.locator('[data-diff-scroll]').getByText(`Subproject commit ${pointer}`)
  ).toBeVisible({ timeout: 30_000 });
  await expect(noChanges(page)).toHaveCount(0);
});

test('a diff cut before its first file ends is not an empty one', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const worktree = worktreeOf(repoPath);
  // Past the 64 MiB patch ceiling on its own, and first in patch order.
  writeFileSync(join(worktree, 'a-huge.txt'), Buffer.alloc(65 << 20, 97));
  writeFileSync(join(worktree, 'z-small.txt'), 'small\n');
  git(worktree, 'rm', '-q', 'notes.txt');
  git(worktree, 'add', 'a-huge.txt', 'z-small.txt');
  git(worktree, 'commit', '-q', '-m', 'a huge file');

  await pushAndOpen(page, homeDir);
  await expect(
    page.getByRole('status', { name: 'Diff cut short' })
  ).toContainText('Showing 0 of 2 files', { timeout: 60_000 });
  await expect(
    page.getByText("No file can be shown: the first file's diff alone passes")
  ).toBeVisible();
  await expect(noChanges(page)).toHaveCount(0);
});
