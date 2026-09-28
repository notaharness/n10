import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import type { FakeGitHub, FakePr } from './setup/fake-gh.js';

/**
 * Who must review, on the Overview, as GitHub says it. GitHub marks no
 * reviewer required: its rules ask for a number of approvals, for code
 * owners, and for teams by id, and a request says only whether it went
 * to a code owner. The Reviewers list names code owners and says GitHub
 * marks no one else; Completion states the rule under its Reviews row.
 * Azure DevOps, which marks each reviewer, is covered by core's and the
 * provider's specs until it has a fake of its own.
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
    { team: 'n10/core', name: 'Core', codeOwner: true },
  ],
  reviews: [{ author: 'dee', state: 'APPROVED' }],
  checks: [{ name: 'build', state: 'SUCCESS' }],
};

const GITHUB: FakeGitHub = {
  username: 'bea',
  rules: {
    approvals: 2,
    codeOwners: true,
    requiredTeams: [{ id: 42, paths: ['src/**'] }],
  },
  prs: [PR],
};

test.use({ repo: { worktrees: [{ branch: 'split-queue' }] } });

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

  test('names code owners, and says GitHub marks no one required', async ({
    desktop,
  }) => {
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
    await expect(reviewers).toContainText(
      "GitHub doesn't mark reviewers required."
    );
  });

  test('states the rule under the Reviews row, and waits on the viewer', async ({
    desktop,
  }) => {
    const { completion } = await openOverview(desktop.page);
    const reviews = completion.locator('[data-readiness-row="reviews"]');
    await expect(reviews).toContainText('Waiting for review');
    // One requirement a line.
    await expect(reviews.locator('[data-review-rule] > span')).toHaveText([
      '2 approvals required',
      'Code owners must approve',
      '1 approval from a required team (src/**)',
    ]);
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

  test('says so, rather than stating no rule', async ({ desktop }) => {
    const { completion } = await openOverview(desktop.page);
    await expect(
      completion.locator('[data-readiness-row="reviews"] [data-review-rule]')
    ).toHaveText('The review rules could not be read.');
  });
});
