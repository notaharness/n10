import type { Locator, Page } from '@playwright/test';
import { AZURE_REVIEWERS } from './fixtures/azure-reviewers.js';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * The Overview's reviewer rules and activity cards, pixel for pixel in
 * the pinned container (see `visual.test.ts`): the tip a required team's
 * standing opens, with the rule set's paths one a line, and a review
 * thread with its labels on the header row and its reply and resolve;
 * and, on Azure DevOps in the dark theme, the required reviewers above
 * the optional with a policy's tip open over the list.
 */

const shot = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixels: 0,
} as const;

/** Hours before the run, so "3h ago" reads the same on every run. */
const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  rules: {
    approvals: 1,
    requiredTeams: [{ id: 42, paths: ['apps/desktop/**', 'libs/app-core/**'] }],
  },
  prs: [
    {
      number: 214,
      title: 'Handle cancelled requests',
      headRefName: 'cancel-requests',
      author: 'alex',
      rollup: 'SUCCESS',
      reviewRequests: [
        'n10-tester',
        { team: 'n10/desktop', name: 'Desktop', id: 42 },
      ],
      mergeStateStatus: 'BLOCKED',
      reviewDecision: 'REVIEW_REQUIRED',
      checks: [{ name: 'build', state: 'SUCCESS', required: true }],
      body: 'A cancelled request kept its socket open.',
      threads: [
        {
          id: 'T-labelled',
          path: 'request.ts',
          line: 1,
          diffHunk: ['@@ -0,0 +1,1 @@', '+export function cancel() {}'].join(
            '\n'
          ),
          comments: [
            {
              author: 'bea',
              body: 'issue (blocking): cancelling leaves the retry timer running\n\nThe early return skips `timer.stop()`.',
              createdAt: hoursAgo(3),
            },
            {
              author: 'alex',
              body: 'Fixed in the next push.',
              createdAt: hoursAgo(2),
            },
          ],
        },
      ],
    },
  ],
};

test.use({
  repo: {
    name: 'n10-visual',
    worktrees: [
      {
        branch: 'cancel-requests',
        files: { 'request.ts': 'export function cancel() {}\n' },
      },
    ],
  },
  fakeGitHub: GITHUB,
});

async function openOverview(page: Page) {
  await sidebarRow(page, /#214/).first().click();
  await expect(page.getByRole('region', { name: 'Completion' })).toBeVisible({
    timeout: 30_000,
  });
}

/** A tip, once it has zoomed in: its box is measured before the
 *  screenshot stops the animation. */
async function settled(tip: Locator) {
  await tip.evaluate((el) => {
    const content = el.closest('[data-slot="tooltip-content"]');
    if (!content) throw new Error('the tip is outside its tooltip content');
    return Promise.all(
      content.getAnimations({ subtree: true }).map((a) => a.finished)
    );
  });
}

/** The area two elements cover together: a section and the tip it
 *  opens, which a portal draws outside it. */
async function around(a: Locator, b: Locator) {
  const [x, y] = [await a.boundingBox(), await b.boundingBox()];
  if (!x || !y) throw new Error('nothing to frame');
  const left = Math.min(x.x, y.x) - 8;
  const top = Math.min(x.y, y.y) - 8;
  return {
    x: left,
    y: top,
    width: Math.max(x.x + x.width, y.x + y.width) + 8 - left,
    height: Math.max(x.y + x.height, y.y + y.height) + 8 - top,
  };
}

test.describe('Visual (review) @visual', () => {
  test('a required team’s rules on hover', async ({ desktop }) => {
    const { page } = desktop;
    await openOverview(page);
    const reviewers = page.getByRole('region', { name: 'Reviewers' });
    await reviewers
      .locator('[data-reviewer="n10/desktop"] [data-reviewer-standing]')
      .hover();
    const tip = page.locator('[data-reviewer-rules]').filter({ visible: true });
    await expect(tip.locator('li')).toHaveCount(2);
    await settled(tip);
    await expect(page).toHaveScreenshot('reviewer-rules-hover.png', {
      ...shot,
      clip: await around(reviewers, tip),
    });
  });

  test('a review thread in the activity, with its actions', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openOverview(page);
    const card = page.locator('[data-thread-id="T-labelled"]');
    // The activity settles before it is framed: its card is drawn again
    // once the diff's threads, which carry its actions, arrive.
    await expect(card.getByText('Fixed in the next push.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Resolve' })).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveScreenshot('activity-thread-actions.png', shot);
  });
});

test.describe('Visual (reviewers on Azure DevOps, dark theme) @visual', () => {
  test.use({
    fakeGitHub: undefined,
    fakeAzure: AZURE_REVIEWERS,
    desktopPrefs: { theme: 'dark', nativeFrame: false },
    repo: { name: 'n10-visual', worktrees: [{ branch: 'cancel-requests' }] },
  });

  test('the required first, and a policy’s tip over the list', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, /#4211/).first().click();
    const reviewers = page.getByRole('region', { name: 'Reviewers' });
    await expect(
      reviewers.getByRole('heading', { name: 'Optional' })
    ).toBeVisible({ timeout: 30_000 });
    // Hovered once the Overview has settled: a read landing later moves
    // the list under the pointer, and the tip closes.
    await expect(
      page.locator('[data-readiness-headline]').first()
    ).toBeVisible();
    await expect(page.getByRole('region', { name: /Activity/ })).toContainText(
      'No comments, reviews or activity yet.'
    );
    await reviewers
      .locator('[data-reviewer^="[Fabrikam]"] [data-reviewer-standing]')
      .hover();
    const tip = page.locator('[data-reviewer-rules]').filter({ visible: true });
    await expect(tip.locator('li')).toHaveCount(2);
    await settled(tip);
    // The whole window: a clip loses the tip, which a portal draws over
    // the list inside the clipped area.
    await expect(page).toHaveScreenshot('reviewer-groups-hover-dark.png', shot);
  });
});
