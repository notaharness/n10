import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import type { FakeGitHub, FakePr } from './setup/fake-gh.js';

/**
 * Who must review, on the Overview, as GitHub says it. GitHub marks no
 * reviewer required: its rules ask for a number of approvals, for code
 * owners, and for teams by id, and a request says only whether it went
 * to a code owner. The Reviewers list names code owners, shows no one
 * as required, and shows the rules that name a reviewer on hover;
 * Completion's Reviews row is the verdict and the count.
 * Azure DevOps, which marks each reviewer, is in
 * `pr-reviewer-groups.test.ts`.
 */

const PR: FakePr = {
  number: 301,
  title: 'Split the request queue',
  headRefName: 'split-queue',
  author: 'alex',
  mergeStateStatus: 'BLOCKED',
  reviewDecision: 'REVIEW_REQUIRED',
  reviewRequests: [
    'bea',
    { login: 'cam', codeOwner: true },
    { team: 'n10/core', name: 'Core', codeOwner: true, id: 42 },
  ],
  reviews: [{ author: 'dee', state: 'APPROVED' }],
  checks: [{ name: 'build', state: 'SUCCESS' }],
};

const GITHUB: FakeGitHub = {
  username: 'bea',
  rules: {
    approvals: 2,
    codeOwners: true,
    requiredTeams: [{ id: 42, paths: ['src/**', 'libs/queue/**'] }],
  },
  prs: [PR],
};

test.use({ repo: { worktrees: [{ branch: 'split-queue' }] } });

/** Move the pointer onto a spot in steps: Radix closes a tooltip on
 *  the pointer's next move outside the way to it, not on the leave. */
async function pointAt(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to point at');
  await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 8 });
}

async function openOverview(page: Page) {
  await sidebarRow(page, /#301/).first().click();
  const completion = page.getByRole('region', { name: 'Completion' });
  await expect(completion).toBeVisible({ timeout: 30_000 });
  return {
    reviewers: page.getByRole('region', { name: 'Reviewers' }),
    completion,
  };
}

test.describe('Reviewer requirements on GitHub', () => {
  test.use({ fakeGitHub: GITHUB });

  test('names code owners, and marks no one required', async ({ desktop }) => {
    const { reviewers } = await openOverview(desktop.page);
    const row = (id: string) => reviewers.locator(`[data-reviewer="${id}"]`);
    // The detail read names the team the list row leaves out.
    await expect(row('n10/core')).toContainText('Core');
    await expect(row('n10/core')).toContainText('Code owner');
    await expect(row('cam')).toContainText('Code owner');
    // Asked, or approved, and nothing more known: no standing.
    await expect(row('bea')).toContainText('(you)');
    await expect(row('bea').locator('[data-reviewer-standing]')).toHaveCount(0);
    await expect(row('dee')).toContainText('Approved');
    await expect(row('dee').locator('[data-reviewer-standing]')).toHaveCount(0);
    // GitHub marks no one required, so none is shown as required, and
    // nothing explains why.
    await expect(reviewers).not.toContainText('Required');
    await expect(reviewers).not.toContainText("doesn't mark");
    await expect(
      reviewers.getByRole('heading', { name: 'Optional' })
    ).toHaveCount(0);
  });

  test('shows the rules that name a team, with their paths, on hover', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const { reviewers } = await openOverview(page);
    const core = reviewers.locator('[data-reviewer="n10/core"]');
    await core.locator('[data-reviewer-standing]').hover();
    const tip = page.locator('[data-reviewer-rules]').filter({ visible: true });
    await expect(tip).toContainText('Ruleset');
    await expect(tip).toContainText('1 approval required');
    // One path a line.
    await expect(tip.locator('li')).toHaveText(['src/**', 'libs/queue/**']);
    await expect(tip).toContainText('Code owner review');
    // Leaving the standing closes it.
    await pointAt(page, reviewers.locator('[data-reviewer="bea"]'));
    await expect(tip).toHaveCount(0);
    // A code owner no ruleset names explains only the code-owner rule.
    await reviewers
      .locator('[data-reviewer="cam"] [data-reviewer-standing]')
      .hover();
    await expect(tip).toContainText('Code owner review');
    await expect(tip).not.toContainText('Ruleset');
  });

  test('shows the rules at once, and hides them at once, where motion is reduced', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { reviewers } = await openOverview(page);
    // Every animation the tip starts, from before it opens.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { tipAnimations: string[] }).tipAnimations = seen;
      document.addEventListener('animationstart', (e) => {
        const el = e.target as Element;
        if (el.closest('[data-slot="tooltip-content"]')) {
          seen.push(e.animationName);
        }
      });
    });
    const started = () =>
      page.evaluate(
        () => (window as unknown as { tipAnimations: string[] }).tipAnimations
      );
    await reviewers
      .locator('[data-reviewer="n10/core"] [data-reviewer-standing]')
      .hover();
    const tip = page.locator('[data-slot="tooltip-content"]');
    await expect(tip).toContainText('Ruleset');
    // Whole from its first frame: no fade to catch it halfway through.
    await expect(tip).toHaveCSS('opacity', '1');
    await pointAt(page, reviewers.locator('[data-reviewer="bea"]'));
    await expect(tip).toHaveCount(0);
    expect(await started()).toEqual([]);
  });

  test('reads the verdict and the count on the Reviews row, and waits on the viewer', async ({
    desktop,
  }) => {
    const { completion } = await openOverview(desktop.page);
    const reviews = completion.locator('[data-readiness-row="reviews"]');
    // Who must approve, and why, is the Reviewers list's to say.
    await expect(reviews).toContainText(
      'Waiting for review · 2 approvals required'
    );
    await expect(reviews).not.toContainText('Code owners');
    // GitHub asked Bea, and does not say her review is optional.
    await expect(completion.locator('[data-readiness-headline]')).toContainText(
      'Waiting for your review'
    );
  });
});

test.describe('Reviewer requirements when the rules cannot be read', () => {
  test.use({
    fakeGitHub: { ...GITHUB, rules: { ...GITHUB.rules, failing: true } },
  });

  test('says so on the Reviews row, rather than stating no count', async ({
    desktop,
  }) => {
    const { completion } = await openOverview(desktop.page);
    await expect(
      completion.locator('[data-readiness-row="reviews"]')
    ).toContainText("Waiting for review · branch rules didn't load");
  });
});
