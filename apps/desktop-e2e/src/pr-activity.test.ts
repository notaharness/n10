import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  REVIEW_FILES,
  reviewConversation,
} from './fixtures/conversation-review.js';
import { sidebarRow } from './setup/app.js';
import { updateFakeGh, type FakeGitHub } from './setup/fake-gh.js';

/**
 * The Overview's activity (C1, C2): the whole conversation in order,
 * its filters and search, the code an outdated thread was written on,
 * the way into the diff, and updates that wait rather than moving the
 * list under the reader.
 */

const BRANCH = 'cancel-requests';

const GITHUB: FakeGitHub = {
  username: 'bea',
  prs: [
    {
      number: 214,
      title: 'Handle cancelled requests',
      headRefName: BRANCH,
      author: 'alex',
      body: 'Cancelled requests leak their timer.',
      ...reviewConversation(),
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: { worktrees: [{ branch: BRANCH, files: REVIEW_FILES }] },
});

async function openOverview(page: Page) {
  await sidebarRow(page, /Handle cancelled requests|#214/)
    .first()
    .click();
  await page.getByRole('button', { name: 'Overview' }).click();
  const activity = page.getByRole('region', { name: /Activity/ });
  await expect(activity.getByRole('list').first()).toBeVisible({
    timeout: 30_000,
  });
  return activity;
}

test.describe('Pull request activity', () => {
  test('reads the whole conversation in order, with each entry’s provenance', async ({
    desktop,
  }, testInfo) => {
    const { page } = desktop;
    const activity = await openOverview(page);

    const items = activity.locator(':scope > ol > li');
    // Two commits in a row read as one push; the bot's comment folds.
    await expect(items.nth(0)).toContainText('alex added 2 commits');
    await expect(items.nth(1)).toContainText(
      'requested review from Core (team)'
    );
    await expect(items.nth(2)).toContainText('Cancelled requests used to leak');
    await expect(items.nth(3)).toContainText('1 automated update');
    await expect(items.nth(4)).toContainText('bea');
    await expect(items.nth(4)).toContainText(
      'requested changes with 2 comments'
    );

    // The outdated left-side thread shows the code it was written on.
    const outdated = activity.locator('[data-thread-id="T-outdated"]');
    await expect(outdated).toContainText('Outdated');
    await expect(outdated.getByRole('figure')).toContainText(
      'Original context'
    );
    await expect(outdated.getByRole('figure')).toContainText('old 4');
    await expect(outdated.getByRole('figure')).toContainText(
      'send(token, { retry: true });'
    );

    // Resolved starts folded to its author and first line, and says who
    // resolved it.
    const resolved = activity.locator('[data-thread-id="T-resolved"]');
    await expect(resolved).toContainText('Resolved');
    await expect(resolved).toContainText('alex');
    await expect(
      resolved.getByRole('button', { expanded: false })
    ).toContainText('bea');
    await expect(resolved).toContainText('— Nit: name this');
    await expect(resolved.locator('[data-comment-id]')).toHaveCount(0);

    // The file-level thread names the file, not a line.
    await expect(activity.locator('[data-thread-id="T-file"]')).toContainText(
      'assets/logo.png · file'
    );

    // A summary-only approval keeps its text and verdict.
    await expect(activity).toContainText('Read it end to end — looks right.');

    await page.screenshot({ path: testInfo.outputPath('activity.png') });
    await activity
      .locator('[data-thread-id="T-long"]')
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('activity-long.png') });
  });

  test('filters by status and finds a reply folded deep in a thread', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const activity = await openOverview(page);
    const filters = activity.getByRole('radiogroup', { name: 'Show' });

    await filters.getByRole('radio', { name: /Resolved/ }).click();
    await expect(activity.locator('[data-thread-id]')).toHaveCount(1);
    await expect(
      activity.locator('[data-thread-id="T-resolved"]')
    ).toBeVisible();

    await filters.getByRole('radio', { name: /Outdated/ }).click();
    await expect(activity.locator('[data-thread-id]')).toHaveCount(1);

    await filters.getByRole('radio', { name: /Mine/ }).click();
    await expect(activity.getByText('requested changes')).toBeVisible();

    await filters.getByRole('radio', { name: /^All/ }).click();
    const long = activity.locator('[data-thread-id="T-long"]');
    await expect(long.getByText('An AbortSignal')).toHaveCount(0);
    await expect(long).toContainText('Show 6 more replies');

    await activity
      .getByRole('searchbox', { name: 'Search activity' })
      .fill('needle');
    await expect(activity.locator('[data-thread-id]')).toHaveCount(1);
    await expect(
      long.getByText('An AbortSignal would be the needle')
    ).toBeVisible();

    await activity.getByRole('searchbox').fill('nothing like this');
    await activity.getByRole('button', { name: 'Clear filters' }).click();
    await expect(activity.locator('[data-thread-id]')).toHaveCount(5);

    // Unfolding moves focus to the first reply it shows.
    await long.getByRole('button', { name: 'Show 6 more replies' }).click();
    await expect(long.locator(':focus')).toContainText('Discussion 2.');
  });

  test('opens a thread in the diff at its place', async ({ desktop }) => {
    const { page } = desktop;
    const activity = await openOverview(page);
    await activity
      .getByRole('button', {
        name: 'Show the thread on src/request.ts · new 3 in the diff',
      })
      .click();
    await expect(
      page.locator('[data-comment-row="T-open"][aria-current="true"]')
    ).toBeVisible();
    await expect(
      page
        .locator('[data-thread="T-open"]')
        .getByText('Does an early return here skip')
    ).toBeVisible();
  });

  test('holds what arrives on a refresh behind "new updates"', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    const activity = await openOverview(page);
    await expect(activity.getByText('Late to the party')).toHaveCount(0);

    updateFakeGh(homeDir, (s) => {
      s.prs[0]!.generalComments!.push({
        author: 'carol',
        body: 'Late to the party, but this looks good.',
        createdAt: '2026-09-20T14:00:00Z',
      });
    });
    // Resolving a thread in the diff re-reads the conversation.
    await activity
      .getByRole('button', {
        name: 'Show the thread on src/request.ts · new 3 in the diff',
      })
      .click();
    await page
      .locator('[data-thread="T-open"]')
      .getByRole('button', { name: 'Resolve' })
      .click();
    await page.getByRole('button', { name: 'Overview' }).click();

    const update = activity.getByRole('button', { name: '1 new update' });
    await expect(update).toBeVisible({ timeout: 15_000 });
    await expect(activity.getByText('Late to the party')).toHaveCount(0);
    // The thread the reader already had in view shows its new status,
    // and stays open rather than folding under them.
    const open = activity.locator('[data-thread-id="T-open"]');
    await expect(open).toContainText('Resolved');
    await expect(open.locator('[data-comment-id]')).toHaveCount(2);

    await update.click();
    await expect(activity.getByText('Late to the party')).toBeVisible();
    await expect(update).toHaveCount(0);
    // Focus moves to what arrived, not back to the page.
    await expect(activity.locator('li:focus')).toContainText(
      'Late to the party'
    );
  });

  test('says the conversation failed to load, and keeps the description', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    updateFakeGh(homeDir, (s) => {
      s.prs[0]!.failing = { conversation: true };
    });
    await sidebarRow(page, /Handle cancelled requests|#214/)
      .first()
      .click();
    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: "Couldn't load the conversation" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText('Cancelled requests leak their timer.')
    ).toBeVisible();
  });
});
