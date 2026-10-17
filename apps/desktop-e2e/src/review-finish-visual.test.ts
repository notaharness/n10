import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { resizeWindow, sidebarRow } from './setup/app.js';
import { updateFakeGh } from './setup/fake-gh.js';
import { openFinishForm, showComments } from './setup/finish-form.js';
import { git } from './setup/pr-diff.js';

/**
 * Filing a review, pixel for pixel in the pinned container (see
 * `visual.test.ts`): the Finish review form over the diff with a
 * comment chosen and changes requested. The commits are made at a
 * fixed date, so the head is the same on every run.
 */

const shot = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixels: 0,
} as const;

const BRANCH = 'retry-budget';
const FILE = 'src/retry.ts';

test.use({
  fakeGitHub: {
    username: 'bea',
    prs: [
      {
        number: 321,
        title: 'Cap retries per request',
        headRefName: BRANCH,
        author: 'alex',
      },
    ],
  },
  repo: {
    name: 'n10-visual',
    commitDate: '2026-01-05T09:00:00Z',
    baseFiles: {
      [FILE]: 'export const RETRIES = 5;\nexport const WAIT = 100;\n',
    },
    worktrees: [
      {
        branch: BRANCH,
        files: {
          [FILE]: 'export const RETRIES = 3;\nexport const WAIT = 250;\n',
        },
      },
    ],
  },
});

async function openOverview({
  page,
  homeDir,
  repoPath,
}: {
  page: Page;
  homeDir: string;
  repoPath: string;
}) {
  const head = git(repoPath, 'rev-parse', BRANCH);
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.headRefOid = head;
  });
  await sidebarRow(page, /Cap retries per request|#321/)
    .first()
    .click();
}

test.describe('Visual (filing a review) @visual', () => {
  test('the diff toolbar, in one row and wrapped', async ({ desktop }) => {
    const { app, page } = desktop;
    await openOverview(desktop);
    await page
      .getByRole('button', { name: 'Review changes' })
      .click({ timeout: 30_000 });
    const toolbar = page.getByTestId('diff-toolbar');
    await expect(
      toolbar.getByRole('button', { name: 'Finish review' })
    ).toBeVisible();
    // Finish review shows as soon as the pane has a diff to file on; the
    // comparison waits for the file list's read. A screenshot that settles
    // in between is stable, so the comparison has to be on screen first.
    await expect(toolbar.getByTestId('revision-selector')).toHaveText(
      'All changes'
    );
    await expect(toolbar.getByTestId('diff-comparison')).toBeVisible();
    await expect(toolbar).toHaveScreenshot('diff-toolbar.png', shot);
    await resizeWindow(app, 900, 700);
    await expect(toolbar).toHaveScreenshot('diff-toolbar-narrow.png', shot);
  });

  test('the Finish review form', async ({ desktop }) => {
    const { page } = desktop;
    await openOverview(desktop);
    await page
      .getByRole('button', { name: 'Review changes' })
      .click({ timeout: 30_000 });
    const gutter = page.locator(`[data-file="${FILE}"][data-point="RIGHT:1"]`);
    await gutter.click();
    await page.getByRole('button', { name: 'Comment on new line 1' }).click();
    await page.getByRole('textbox', { name: 'Comment' }).fill('Why three?');
    await page.getByRole('button', { name: 'Add to review' }).click();

    const form = await openFinishForm(page);
    await form
      .getByRole('textbox', { name: 'Summary' })
      .fill('Three retries is too few.');
    await form.getByRole('radio', { name: 'Request changes' }).click();
    await showComments(form);
    await expect(
      form.getByRole('checkbox', { name: `${FILE}:1` })
    ).toBeChecked();
    await expect(form).toHaveScreenshot('finish-review-form.png', shot);
  });
});
