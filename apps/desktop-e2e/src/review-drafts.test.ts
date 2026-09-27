import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  REVIEW_FILES,
  reviewConversation,
} from './fixtures/conversation-review.js';
import { sidebarRow, tab, tabs } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * A reply is the reviewer's own draft until it is sent (F3, C5): kept
 * as typed across a renderer restart and a tab switch, private to the
 * account that wrote it, loud when it could not be saved, and gone
 * once it is posted.
 */

const BRANCH = 'cancel-requests';
const TEXT = 'First, the early return.\n\n  - keeps its indent\n\nThanks!';

const GITHUB: FakeGitHub = {
  username: 'bea',
  prs: [
    {
      number: 214,
      title: 'Handle cancelled requests',
      headRefName: BRANCH,
      author: 'alex',
      ...reviewConversation(),
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: { worktrees: [{ branch: BRANCH, files: REVIEW_FILES }] },
});

/** The open thread, shown in the diff through the Overview. */
async function openThread(page: Page) {
  await sidebarRow(page, /Handle cancelled requests|#214/)
    .first()
    .click();
  await page.getByRole('button', { name: 'Overview' }).click();
  await page
    .getByRole('button', {
      name: 'Show the thread on src/request.ts · new 3 in the diff',
    })
    .click({ timeout: 30_000 });
  return page.locator('[data-thread="T-open"]');
}

/** Point the repository's config at another GitHub account. */
function actAs(repoPath: string, homeDir: string, username: string) {
  const key = createHash('sha256').update(repoPath).digest('hex').slice(0, 16);
  const path = join(homeDir, '.n10', 'projects', key, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.vendorProject.username = username;
  writeFileSync(path, JSON.stringify(config, null, 2));
}

test.describe('Review drafts', () => {
  test('a reply survives a restart and a closed tab, exactly as typed', async ({
    desktop,
  }) => {
    const { page } = desktop;
    let thread = await openThread(page);
    await thread.getByRole('button', { name: 'Reply…' }).click();
    await thread.getByRole('textbox', { name: 'Reply' }).fill(TEXT);
    await expect(thread.getByRole('status')).toHaveText('Draft saved');
    await thread.getByRole('button', { name: 'Close' }).click();

    // Closed, the box says there is a draft and opens on it.
    const prompt = thread.getByRole('button', { name: /Your draft reply/ });
    await expect(prompt).toContainText('First, the early return.');

    await page.reload();
    thread = await openThread(page);
    await thread.getByRole('button', { name: /Your draft reply/ }).click();
    await expect(thread.getByRole('textbox', { name: 'Reply' })).toHaveValue(
      TEXT
    );

    // Typing and closing the tab at once still keeps what was typed.
    await thread.getByRole('textbox', { name: 'Reply' }).fill(TEXT + ' More.');
    await tab(page, /Handle cancelled requests|#214/)
      .getByLabel('Close tab')
      .click();
    await expect(tabs(page)).toHaveCount(0);
    thread = await openThread(page);
    await thread.getByRole('button', { name: /Your draft reply/ }).click();
    await expect(thread.getByRole('textbox', { name: 'Reply' })).toHaveValue(
      TEXT + ' More.'
    );
  });

  test('another account never sees the draft', async ({ desktop }) => {
    const { page, repoPath, homeDir } = desktop;
    let thread = await openThread(page);
    await thread.getByRole('button', { name: 'Reply…' }).click();
    await thread.getByRole('textbox', { name: 'Reply' }).fill('Only for bea');
    await expect(thread.getByRole('status')).toHaveText('Draft saved');

    actAs(repoPath, homeDir, 'carol');
    await page.reload();
    thread = await openThread(page);
    await expect(thread.getByRole('button', { name: 'Reply…' })).toBeVisible();
    await expect(thread.getByText('Only for bea')).toHaveCount(0);

    actAs(repoPath, homeDir, 'bea');
    await page.reload();
    thread = await openThread(page);
    await expect(
      thread.getByRole('button', { name: /Your draft reply/ })
    ).toContainText('Only for bea');
  });

  test('a draft that could not be saved asks before it is closed', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    const dir = join(homeDir, '.n10', 'review-drafts');
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o500);
    try {
      const thread = await openThread(page);
      await thread.getByRole('button', { name: 'Reply…' }).click();
      const box = thread.getByRole('textbox', { name: 'Reply' });
      await box.fill('Nowhere to keep this');
      await expect(thread.getByRole('status')).toContainText(
        "Couldn't save draft"
      );

      await box.press('Escape');
      const choice = thread.getByRole('alertdialog', {
        name: "This draft isn't saved",
      });
      await expect(choice).toBeVisible();
      await choice.getByRole('button', { name: 'Keep editing' }).click();
      await expect(box).toHaveValue('Nowhere to keep this');

      // Once the disk takes it again, Retry saves it.
      chmodSync(dir, 0o700);
      await thread.getByRole('button', { name: 'Retry' }).click();
      await expect(thread.getByRole('status')).toHaveText('Draft saved');
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  test('sending the reply clears its draft', async ({ desktop }) => {
    const { page } = desktop;
    let thread = await openThread(page);
    await thread.getByRole('button', { name: 'Reply…' }).click();
    await thread.getByRole('textbox', { name: 'Reply' }).fill('Sent now');
    await expect(thread.getByRole('status')).toHaveText('Draft saved');
    await thread.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(thread.getByText('Sent now')).toBeVisible();
    await expect(thread.getByRole('button', { name: 'Reply…' })).toBeVisible();

    await page.reload();
    thread = await openThread(page);
    await expect(thread.getByRole('button', { name: 'Reply…' })).toBeVisible();
  });
});
