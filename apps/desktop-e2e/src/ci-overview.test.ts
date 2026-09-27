import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import { RECORDED_HEAD, recordedCiApi } from './setup/ci-fixture.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * The CI page (preview), offline: the fake `gh` answers with a recorded
 * `sharkdp/bat` run, so the page shows what GitHub's Actions API
 * returned for a real failure — two workflow runs, 23 jobs in one of
 * them, a failed lint job, a skipped one — and the failed job's log.
 */

const BRANCH = 'ci-review';

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [
    {
      number: 4020,
      title: 'Make -ppp disable syntax highlighting',
      headRefName: BRANCH,
      headRefOid: RECORDED_HEAD,
    },
  ],
  api: recordedCiApi('n10', 'fixture'),
};

test.use({
  fakeGitHub: GITHUB,
  repo: { worktrees: [{ branch: BRANCH, files: { 'a.txt': 'a\n' } }] },
});

async function openCi(page: Page) {
  await sidebarRow(page, /Make -ppp disable syntax highlighting|#4020/)
    .first()
    .click();
  const entry = page.getByRole('button', { name: /^CI\b/ });
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await entry.click();
  return page.locator('[data-ci-page]');
}

const job = (page: Page, name: string) =>
  page.locator(`[data-ci-job="${name}"]`);

test('lists every workflow run for the head commit with its jobs', async ({
  desktop,
}) => {
  const { page } = desktop;
  const ci = await openCi(page);

  await expect(ci.getByText('Preview')).toBeVisible();
  await expect(
    ci.getByText('GitHub Actions · 2 pipelines · 1 failed')
  ).toBeVisible({ timeout: 30_000 });

  const cicd = ci.locator('[data-ci-pipeline="CICD"]');
  await expect(cicd.getByRole('heading', { name: 'CICD' })).toBeVisible();
  await expect(
    cicd.getByText('pull_request · beb1258 · 13m 11s')
  ).toBeVisible();
  await expect(cicd.locator('[data-ci-job]')).toHaveCount(23);
  await expect(
    ci.locator('[data-ci-pipeline="Changelog"] [data-ci-job]')
  ).toHaveCount(1);

  await expect(
    job(page, 'Ensure code quality').locator('[data-ci-status]')
  ).toHaveAttribute('data-ci-status', 'failed');
  await expect(
    job(page, 'Publish to Winget').locator('[data-ci-status]')
  ).toHaveAttribute('data-ci-status', 'skipped');
});

test("shows a job's steps and the tail of its log", async ({ desktop }) => {
  const { page } = desktop;
  await openCi(page);

  await job(page, 'Ensure code quality').click();
  const steps = page.getByRole('list', { name: 'Steps' });
  const clippy = steps.locator(
    '[data-ci-step="Run cargo clippy --locked --all-targets --all-features -- -D warnings"]'
  );
  await expect(clippy.locator('[data-ci-status]')).toHaveAttribute(
    'data-ci-status',
    'failed'
  );
  await expect(steps.locator('[data-ci-step]')).toHaveCount(7);

  const log = page.getByRole('log', { name: 'Log' });
  await expect(
    log.getByText('##[error]Process completed with exit code 101.')
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Lines 431–930 of 930')).toBeVisible();
  // Timestamps and colour codes are gone; the log reads as text.
  await expect(log).not.toContainText('2026-09-26T20:');
});

test('says a skipped job has no log', async ({ desktop }) => {
  const { page } = desktop;
  await openCi(page);

  await job(page, 'Publish to Winget').click();
  await expect(page.getByText('This job did not run.')).toBeVisible();
  await expect(page.getByRole('log')).toHaveCount(0);

  await page.getByRole('button', { name: 'Close job details' }).click();
  await expect(page.getByText('This job did not run.')).toHaveCount(0);
});
