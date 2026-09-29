import type { Locator, Page } from '@playwright/test';
import {
  AZURE_REVIEWERS,
  REVIEWER_ID as ID,
} from './fixtures/azure-reviewers.js';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import { fakeAdoMisses } from './setup/fake-ado.js';

/**
 * Who must review, as Azure DevOps says it: it marks each reviewer
 * required or optional, and its Required reviewers policies name them.
 * The Reviewers list shows the required first and the optional under a
 * heading; a row adds only why they were asked, and a policy that names
 * them shows on hover with its paths.
 */

test.use({
  fakeAzure: AZURE_REVIEWERS,
  repo: { worktrees: [{ branch: 'cancel-requests' }] },
});

/** A reviewer's standing line, by their identifier: an Azure group's
 *  carries a backslash, which a CSS string must escape. */
function standingOf(reviewers: Locator, id: string) {
  const css = id.replaceAll('\\', '\\\\');
  return reviewers.locator(`[data-reviewer="${css}"] [data-reviewer-standing]`);
}

async function openReviewers(page: Page) {
  await sidebarRow(page, /#4211/).first().click();
  const reviewers = page.getByRole('region', { name: 'Reviewers' });
  await expect(reviewers.locator('[data-reviewer]')).toHaveCount(4, {
    timeout: 30_000,
  });
  return reviewers;
}

test.describe('Reviewer groups on Azure DevOps', () => {
  test('lists the required first, then the optional under a heading', async ({
    desktop,
  }) => {
    const reviewers = await openReviewers(desktop.page);
    const names = (group: string) =>
      reviewers.locator(`[data-reviewer-group="${group}"] [data-reviewer]`);
    await expect(names('required')).toHaveCount(2);
    await expect(names('required').nth(0)).toContainText('API reviewers');
    await expect(names('required').nth(1)).toContainText('Team DES');
    await expect(
      reviewers
        .getByRole('list', { name: 'Optional' })
        .locator('[data-reviewer]')
    ).toHaveCount(2);
    await expect(names('Optional').nth(0)).toContainText('Harrie Essing');
    await expect(names('Optional').nth(1)).toContainText('Daan Kerkhoff');
    // The heading says required or optional; a row says only why.
    const standing = (id: string) => standingOf(reviewers, id);
    await expect(standing('[Fabrikam]\\API reviewers')).toHaveText('By policy');
    await expect(standing('[Fabrikam]\\Team DES')).toHaveCount(0);
    await expect(standing(`${ID.daan}@contoso.example`)).toHaveText(
      'By policy'
    );
    await expect(standing(`${ID.harrie}@contoso.example`)).toHaveCount(0);
    await expect(reviewers).not.toContainText('Required');
    await expect(reviewers).not.toContainText('Optional,');
  });

  test('shows the policy that names a reviewer, with its paths, on hover', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const reviewers = await openReviewers(page);
    await standingOf(reviewers, '[Fabrikam]\\API reviewers').hover();
    const tip = page.locator('[data-reviewer-rules]').filter({ visible: true });
    await expect(tip).toContainText('Required reviewers');
    await expect(tip).toContainText('1 approval required');
    await expect(tip.locator('li')).toHaveText([
      '/apps/api/*',
      '/libs/queue/*',
    ]);
  });

  test('reads Azure DevOps through the fake alone', async ({ desktop }) => {
    await openReviewers(desktop.page);
    // Anything the fake does not know answers 404 and is noted; the
    // Overview's reads are all known.
    expect(fakeAdoMisses(desktop.homeDir)).toEqual([]);
  });
});
