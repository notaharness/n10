import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  REVIEW_FILES,
  reviewConversation,
} from './fixtures/conversation-review.js';
import { sidebarRow } from './setup/app.js';
import {
  twoDaysAgoAt,
  updateFakeGh,
  type FakeGitHub,
} from './setup/fake-gh.js';

/**
 * The Overview's activity (C1, C2): the whole conversation in order,
 * its filters and search, resolved threads out of view until asked for,
 * the code an outdated thread was written on, the way into the diff,
 * and updates that wait rather than moving the list under the reader.
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
      checks: [{ name: 'build', state: 'SUCCESS', required: true }],
      ...reviewConversation(),
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: { worktrees: [{ branch: BRANCH, files: REVIEW_FILES }] },
});

const filtersOf = (activity: Locator) =>
  activity.getByRole('radiogroup', { name: 'Show' });
const showResolved = (activity: Locator) =>
  activity.getByRole('switch', { name: /Show resolved/ });

/** Bea reviews alex's pull request, which opens on its Overview. */
async function openOverview(page: Page) {
  await sidebarRow(page, /Handle cancelled requests|#214/)
    .first()
    .click();
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

    // Resolved is out of view until asked for; then it starts folded to
    // its author and first line, and says who resolved it.
    const resolved = activity.locator('[data-thread-id="T-resolved"]');
    await expect(resolved).toHaveCount(0);
    await expect(showResolved(activity)).not.toBeChecked();
    await expect(showResolved(activity)).toHaveAccessibleName(
      'Show resolved 1'
    );
    await showResolved(activity).click();
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

    // Open counts threads that can be resolved and are not, never
    // general comments.
    await expect(
      filtersOf(activity).getByRole('radio', { name: /Open/ })
    ).toContainText('4');

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

    // Shown or not, a resolved thread is never Open.
    await showResolved(activity).click();
    await filters.getByRole('radio', { name: /Open/ }).click();
    await expect(activity.locator('[data-thread-id="T-resolved"]')).toHaveCount(
      0
    );
    await filters.getByRole('radio', { name: /^All/ }).click();
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
    // Only the match unfolds; the replies around it stay folded.
    await expect(long.getByText('Discussion 3.')).toHaveCount(0);

    await activity.getByRole('searchbox').fill('nothing like this');
    await activity.getByRole('button', { name: 'Clear filters' }).click();
    await expect(activity.locator('[data-thread-id]')).toHaveCount(5);

    // Unfolding moves focus to the first reply it shows.
    await long.getByRole('button', { name: 'Show 6 more replies' }).click();
    await expect(long.locator(':focus')).toContainText('Discussion 2.');
  });

  test('keeps its filter, search and resolved threads across the check list', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const activity = await openOverview(page);
    const mine = activity
      .getByRole('radiogroup', { name: 'Show' })
      .getByRole('radio', { name: /Mine/ });
    await mine.click();
    const search = activity.getByRole('searchbox', { name: 'Search activity' });
    await search.fill('name this');
    // All that matches is out of view: the empty state says so, and
    // showing it hands the keyboard to the switch.
    await expect(
      activity.getByText('Only resolved threads match (1).')
    ).toBeVisible();
    await activity.getByRole('button', { name: 'Show resolved' }).click();
    await expect(showResolved(activity)).toBeChecked();
    await expect(showResolved(activity)).toBeFocused();
    await expect(
      activity.locator('[data-thread-id="T-resolved"]')
    ).toBeVisible();

    await page
      .getByRole('region', { name: 'Completion' })
      .getByRole('button', { name: /View checks/ })
      .click();
    await page.getByRole('button', { name: 'Back to the Overview' }).click();

    await expect(mine).toBeChecked();
    await expect(showResolved(activity)).toBeChecked();
    await expect(search).toHaveValue('name this');
    await expect(
      activity.locator('[data-thread-id="T-resolved"]')
    ).toBeVisible();
  });

  test('opens a thread in the diff at its place', async ({ desktop }) => {
    const { page } = desktop;
    const activity = await openOverview(page);
    // A thread's header says who and where, not how many comments.
    const COUNT = /\d+ comments?\b/;
    const toggle = (card: Locator) =>
      card.locator('button[aria-expanded]').first();
    const overview = activity.locator('[data-thread-id="T-open"]');
    await expect(toggle(overview)).toContainText('src/request.ts');
    await expect(toggle(overview)).not.toContainText(COUNT);
    await activity
      .getByRole('button', {
        name: 'Show the thread on src/request.ts · new 3 in the diff',
      })
      .click();
    const diff = page.locator('[data-thread="T-open"]');
    await expect(
      diff.getByText('Does an early return here skip')
    ).toBeVisible();
    await expect(toggle(diff)).not.toContainText(COUNT);
  });

  test('takes keyboard focus to the thread it opens', async ({ desktop }) => {
    const { page } = desktop;
    const activity = await openOverview(page);
    const link = activity.getByRole('button', {
      name: 'Show the thread on src/request.ts · new 3 in the diff',
    });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-thread="T-open"]')).toBeFocused();
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
        createdAt: twoDaysAgoAt(14),
      });
      s.prs[0]!.threads!.find((t) => t.id === 'T-open')!.comments.push({
        author: 'carol',
        body: 'Confirmed on my machine too.',
        createdAt: twoDaysAgoAt(14, 1),
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
    await page.getByRole('button', { name: 'Back to review' }).click();

    // Under a search the arrival would not show in, nothing is
    // announced; the thread just resolved stays in view.
    const filters = activity.getByRole('radiogroup', { name: 'Show' });
    const search = activity.getByRole('searchbox', { name: 'Search activity' });
    await search.fill('early return');
    const update = activity.getByRole('button', { name: '1 new update' });
    // The re-read has landed once the resolved thread leaves Open's count.
    await expect(filters.getByRole('radio', { name: /Open/ })).toContainText(
      '3',
      { timeout: 15_000 }
    );
    // The switch counts what it would bring into view, not the thread
    // resolved in view.
    await expect(showResolved(activity)).toHaveAccessibleName(
      'Show resolved 1'
    );
    await expect(update).toHaveCount(0);
    await search.fill('');
    await expect(update).toBeVisible({ timeout: 15_000 });
    await expect(activity.getByText('Late to the party')).toHaveCount(0);
    // The thread the reader already had in view shows its new status,
    // and stays open rather than folding under them.
    const open = activity.locator('[data-thread-id="T-open"]');
    await expect(open).toContainText('Resolved');
    // A reply in a thread already in view shows at once, marked new.
    await expect(open.locator('[data-comment-id]')).toHaveCount(3);
    await expect(open).toContainText('1 new');
    await expect(
      open
        .locator('[data-comment-id]')
        .filter({ hasText: 'Confirmed on my machine' })
    ).toContainText('New');

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
