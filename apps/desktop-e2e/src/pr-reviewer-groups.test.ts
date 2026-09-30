import type { Locator, Page } from '@playwright/test';
import { AZURE_REVIEWERS } from './fixtures/azure-reviewers.js';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';

/**
 * Who must review, as Azure DevOps says it: it marks each reviewer
 * required or optional, and its Required reviewers policies name them.
 * The Reviewers list shows the required first and the optional under a
 * heading; a row adds only why they were asked, and a policy that names
 * them shows on hover with its paths.
 */

test.use({
  fakeAzureDevOps: AZURE_REVIEWERS,
  repo: { worktrees: [{ branch: 'cancel-requests' }] },
});

async function openReviewers(page: Page) {
  await sidebarRow(page, /#4211/).first().click();
  const reviewers = page.getByRole('region', { name: 'Reviewers' });
  await expect(reviewers.locator('[data-reviewer]')).toHaveCount(4, {
    timeout: 30_000,
  });
  return reviewers;
}

/** A reviewer's row, by the name it shows. */
const row = (reviewers: Locator, name: string) =>
  reviewers.locator('[data-reviewer]', { hasText: name });

test.describe('Reviewer groups on Azure DevOps', () => {
  test('lists the required first, then the optional under a heading', async ({
    desktop,
  }) => {
    const reviewers = await openReviewers(desktop.page);
    const group = (name: string) =>
      reviewers.getByRole('list', { name }).locator('[data-reviewer]');
    await expect(group('Required')).toHaveText([
      /\[Fabrikam\]\\API reviewers/,
      /\[Fabrikam\]\\Team DES/,
    ]);
    // Only the optional have a heading on screen.
    await expect(reviewers.getByRole('heading', { level: 3 })).toHaveText([
      'Optional',
    ]);
    await expect(group('Optional')).toHaveText([
      /Harrie Essing/,
      /Daan Kerkhoff/,
    ]);
    // The heading says required or optional; a row says only why.
    const standing = (name: string) =>
      row(reviewers, name).locator('[data-reviewer-standing]');
    await expect(standing('API reviewers')).toHaveText('By policy');
    await expect(standing('Team DES')).toHaveCount(0);
    await expect(standing('Daan Kerkhoff')).toHaveText('By policy');
    await expect(standing('Harrie Essing')).toHaveCount(0);
    await expect(reviewers).not.toContainText('Required');
    await expect(reviewers).not.toContainText('Optional,');
  });

  test('shows the policy that names a reviewer, with its paths, on hover', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const reviewers = await openReviewers(page);
    await row(reviewers, 'API reviewers')
      .locator('[data-reviewer-standing]')
      .hover();
    const tip = page.locator('[data-reviewer-rules]').filter({ visible: true });
    await expect(tip).toContainText('Required reviewers');
    await expect(tip).toContainText('1 approval required');
    await expect(tip.locator('li')).toHaveText([
      '/apps/api/*',
      '/libs/queue/*',
    ]);
  });
});
