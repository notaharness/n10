import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  fileTree,
  launchAgentFromRail,
  sidebarRow,
  switchRepo,
  tab,
  visibleText,
} from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * Coming back to a tab finds it where it was left: the pane that
 * showed, and in the diff the file picked and the line at the top. The
 * memory is for this run; what no longer exists is not guessed at.
 */

const BRANCHES = ['alpha', 'beta', 'gamma'] as const;
const FILES = ['a', 'b', 'c', 'd', 'e'];

function body(tag: string): string {
  return Array.from({ length: 80 }, (_, i) => `${tag} line ${i + 1}`).join(
    '\n'
  );
}

test.use({
  repo: {
    worktrees: BRANCHES.map((branch) => ({
      branch,
      files: Object.fromEntries(
        FILES.map((f) => [`${f}.txt`, `${body(`${branch}-${f}`)}\n`])
      ),
    })),
  },
});

/** Open the branch's tab and keep it: a single click is a preview,
 *  which the next one replaces. */
async function openKept(page: Page, branch: string): Promise<void> {
  await sidebarRow(page, new RegExp(branch)).click();
  await tab(page, new RegExp(branch)).dblclick();
  await expect(visibleText(page, `${branch}-a line 1`)).toBeVisible({
    timeout: 30_000,
  });
}

/** Press the branch's tab and wait until its pane is the one on
 *  screen. Until then the pane being left is still shown, and a locator
 *  resolved in it stays with it when it becomes the hidden spare. */
async function switchTo(page: Page, branch: string): Promise<void> {
  await tab(page, new RegExp(branch)).click();
  await expect(
    page
      .locator('[data-editor-panes] > :not([data-spare-pane])')
      .filter({ has: page.getByText(branch, { exact: true }) })
  ).toBeVisible();
}

function pickedFile(page: Page) {
  return fileTree(page).filter({ visible: true }).locator('[aria-current]');
}

async function pick(page: Page, file: string): Promise<void> {
  await fileTree(page)
    .filter({ visible: true })
    .getByRole('button', { name: new RegExp(`^${file}`) })
    .click();
  await expect(pickedFile(page)).toHaveAttribute('title', file);
}

/** The diff line at the top of the diff on screen, as `<tag> line <n>`. */
function topLine(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const scroll = Array.from(
      document.querySelectorAll<HTMLElement>('[data-diff-scroll]')
    ).find((el) => el.checkVisibility({ visibilityProperty: true }));
    if (!scroll) return null;
    const box = scroll.getBoundingClientRect();
    for (let y = box.top + 2; y < box.top + 240; y += 4) {
      let el = document.elementFromPoint(box.left + box.width / 2, y);
      for (let up = 0; el && up < 5; up++, el = el.parentElement) {
        const m = /\w+-\w line \d+/.exec(el.textContent ?? '');
        if (m) return m[0];
      }
    }
    return null;
  });
}

async function scrollDiff(page: Page, pixels: number): Promise<void> {
  const scroll = page.locator('[data-diff-scroll]').filter({ visible: true });
  await scroll.hover();
  await page.mouse.wheel(0, pixels);
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
}

test('each tab opens where it was left', async ({ desktop }) => {
  const { page } = desktop;
  for (const branch of BRANCHES) await openKept(page, branch);

  // gamma: a file picked.
  await pick(page, 'b.txt');

  // beta: an agent, which is what a tab opens on while one runs; the
  // reader went to the diff instead.
  await switchTo(page, 'beta');
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
  await pick(page, 'c.txt');

  // alpha: a file picked, and scrolled on into it.
  await switchTo(page, 'alpha');
  await pick(page, 'd.txt');
  await scrollDiff(page, 600);
  await expect.poll(() => topLine(page)).toMatch(/^alpha-d line/);
  const left = await topLine(page);

  // In an order that makes each of them mount again, rather than come
  // back as the pane kept ready for a switch (the one left last).
  await switchTo(page, 'gamma');
  await expect(pickedFile(page)).toHaveAttribute('title', 'b.txt');

  await switchTo(page, 'beta');
  await expect(pickedFile(page)).toHaveAttribute('title', 'c.txt');
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeHidden();

  await switchTo(page, 'alpha');
  await expect(pickedFile(page)).toHaveAttribute('title', 'd.txt');
  await expect.poll(() => topLine(page)).toBe(left);
});

test('a file gone from the diff when its tab comes back starts from the top', async ({
  desktop,
}) => {
  const { page, repoPath } = desktop;
  await openKept(page, 'alpha');
  await openKept(page, 'beta');
  await switchTo(page, 'alpha');
  await pick(page, 'd.txt');
  await scrollDiff(page, 600);

  await switchTo(page, 'beta');
  const worktree = join(repoPath, '.claude', 'worktrees', 'alpha');
  execFileSync('git', ['rm', '-q', 'd.txt'], { cwd: worktree });
  execFileSync('git', ['commit', '-q', '-m', 'drop d'], { cwd: worktree });
  // Beta is left for a third tab, so alpha is no longer the spare and
  // mounts again, reading its diff afresh.
  await openKept(page, 'gamma');

  await switchTo(page, 'alpha');
  await expect(visibleText(page, 'alpha-a line 1')).toBeVisible();
  await expect(pickedFile(page)).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator('[data-diff-scroll]')
        .filter({ visible: true })
        .evaluate((el) => el.scrollTop)
    )
    .toBe(0);
});

test('a tab keeps where it was left across a repository switch', async ({
  desktop,
}) => {
  const { page, repoPath } = desktop;
  const elsewhere = createTestRepo({ name: 'elsewhere' });
  try {
    await openKept(page, 'alpha');
    await pick(page, 'd.txt');
    await scrollDiff(page, 600);
    await expect.poll(() => topLine(page)).toMatch(/^alpha-d line/);
    const left = await topLine(page);

    await switchRepo(page, elsewhere);
    // The tab stays on the strip; pressing it opens its repository again.
    await tab(page, /alpha/).click();
    await expect
      .poll(() => page.evaluate(() => window.n10.getRepo()), {
        timeout: 30_000,
      })
      .toMatchObject({ cwd: repoPath });
    await expect(pickedFile(page)).toHaveAttribute('title', 'd.txt');
    await expect.poll(() => topLine(page)).toBe(left);
  } finally {
    cleanupTestRepo(elsewhere);
  }
});
