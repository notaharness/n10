import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect } from '../fixtures/desktop.js';
import { showChanges, sidebarRow } from './app.js';
import { updateFakeGh } from './fake-gh.js';
import { git } from './pr-diff.js';

/**
 * A pull request whose diff holds images: its branch's worktree, what
 * main and the branch commit, and the diff's image rows.
 */

export const IMAGES_BRANCH = 'images';

/** The fixture options such a test runs under. */
export const IMAGES_FIXTURE = {
  n10Config: { prPollInterval: 1_000 },
  fakeGitHub: {
    username: 'n10-tester',
    prs: [{ number: 41, title: 'Images', headRefName: IMAGES_BRANCH }],
  },
  repo: {
    worktrees: [{ branch: IMAGES_BRANCH, files: { 'notes.txt': 'notes\n' } }],
  },
};

/** `imageRowHeight` in the renderer: two sides have the choice of how
 *  they are compared above their frames; one side does not. */
export const TWO_SIDED_HEIGHT = 402;
export const ONE_SIDED_HEIGHT = 366;
/** `IMAGE_FRAME_HEIGHT` in the renderer. */
export const FRAME_HEIGHT = 320;

export const RED = [220, 38, 38, 255] as const;
export const BLUE = [37, 99, 235, 255] as const;

export const worktreeOf = (repoPath: string) =>
  join(repoPath, '.claude', 'worktrees', IMAGES_BRANCH);

/** Put `files` on main and bring them into the branch, so the pull
 *  request's merge base has them. */
export function seedMain(
  repoPath: string,
  files: Record<string, Buffer>
): void {
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(repoPath, name), bytes);
  }
  git(repoPath, 'add', '--', ...Object.keys(files));
  git(repoPath, 'commit', '-q', '-m', 'images on main');
  git(worktreeOf(repoPath), 'merge', '-q', '--no-edit', 'main');
}

export function commitBranch(repoPath: string, message: string): void {
  const worktree = worktreeOf(repoPath);
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', message);
}

/** Push what was committed and open the pull request's diff once the
 *  app has the new head: the retitle arrives in the same list read. */
export async function pushAndOpen(page: Page, homeDir: string) {
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Images, pushed';
  });
  const row = sidebarRow(page, /Images, pushed/);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await showChanges(page);
}

/** The image row under a file's header. */
export const compareOf = (page: Page, file: string) =>
  page.locator('[data-diff-scroll]').locator(`[data-image-compare="${file}"]`);

/** A side's figure, side by side. */
export const side = (compare: Locator, which: 'before' | 'after') =>
  compare.locator(`[data-image-side="${which}"]`);

/** A side laid over the other in one frame (toggle and slider). */
export const layer = (compare: Locator, which: 'before' | 'after') =>
  compare.locator(`[data-image-layer="${which}"]`);

/** Whether the image has decoded, and its intrinsic size. */
export const decoded = (img: Locator) =>
  img.evaluate((el: HTMLImageElement) =>
    el.complete ? `${el.naturalWidth}×${el.naturalHeight}` : null
  );
