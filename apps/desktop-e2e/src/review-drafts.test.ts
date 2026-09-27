import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
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

/** The quiet "Draft saved" line under a reply box. */
const saved = (thread: Locator) =>
  thread.locator('[data-draft-status="saved"]');

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
    await expect(saved(thread)).toBeVisible();
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
    await expect(saved(thread)).toBeVisible();

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

  test('a draft that could not be saved is never dropped', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    const dir = join(homeDir, '.n10', 'review-drafts');
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o500);
    try {
      let thread = await openThread(page);
      await thread.getByRole('button', { name: 'Reply…' }).click();
      let box = thread.getByRole('textbox', { name: 'Reply' });
      // Closed before the save has even been tried: the failure still
      // reaches the reader, on the closed box.
      await box.fill('Nowhere to keep this');
      await thread.getByRole('button', { name: 'Close' }).click();
      const unsaved = thread.getByRole('button', {
        name: /Your reply isn’t saved/,
      });
      await expect(unsaved).toContainText('Nowhere to keep this');

      // Unmounted with it — the tab closed — the text is still there.
      await tab(page, /Handle cancelled requests|#214/)
        .getByLabel('Close tab')
        .click();
      thread = await openThread(page);
      await thread
        .getByRole('button', { name: /Your reply isn’t saved/ })
        .click();
      box = thread.getByRole('textbox', { name: 'Reply' });
      await expect(box).toHaveValue('Nowhere to keep this');
      await expect(thread.getByRole('alert')).toContainText(
        "Couldn't save draft"
      );

      // Closing it now asks first.
      await box.press('Escape');
      const choice = thread.getByRole('group', {
        name: "This draft isn't saved",
      });
      await expect(choice).toBeVisible();
      await choice.getByRole('button', { name: 'Keep editing' }).click();
      await expect(box).toBeFocused();
      await expect(box).toHaveValue('Nowhere to keep this');

      // Once the disk takes it again, Retry saves it.
      chmodSync(dir, 0o700);
      await thread.getByRole('button', { name: 'Retry' }).click();
      await expect(saved(thread)).toBeVisible();
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  test('a discarded draft can be brought back', async ({ desktop }) => {
    const { page } = desktop;
    const thread = await openThread(page);
    await thread.getByRole('button', { name: 'Reply…' }).click();
    await thread
      .getByRole('textbox', { name: 'Reply' })
      .fill('Second thoughts');
    await expect(saved(thread)).toBeVisible();
    await thread.getByRole('button', { name: 'Discard' }).click();
    await expect(thread.getByRole('button', { name: 'Reply…' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(
      thread.getByRole('button', { name: /Your draft reply/ })
    ).toContainText('Second thoughts');
  });

  test('sending the reply clears its draft', async ({ desktop }) => {
    const { page } = desktop;
    let thread = await openThread(page);
    await thread.getByRole('button', { name: 'Reply…' }).click();
    await thread.getByRole('textbox', { name: 'Reply' }).fill('Sent now');
    await expect(saved(thread)).toBeVisible();
    await thread.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(thread.getByText('Sent now')).toBeVisible();
    await expect(thread.getByRole('button', { name: 'Reply…' })).toBeVisible();

    await page.reload();
    thread = await openThread(page);
    await expect(thread.getByRole('button', { name: 'Reply…' })).toBeVisible();
  });
});
