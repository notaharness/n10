import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * The description as the provider's markdown, through the sanitized
 * path: disclosure blocks, headings under the Overview's own, links
 * that open the repository at the pull request's commit, and markup
 * that must not run.
 */

const HEAD = 'f'.repeat(40);

const BODY = [
  '# Rollout',
  '',
  'Read [the retry notes](docs/retry.md) before merging.',
  '',
  '<details>',
  '<summary>Rollout plan</summary>',
  '',
  '1. Ship behind the flag',
  '2. Remove the flag after a week',
  '',
  '</details>',
  '',
  '<script>window.__pwned = "script"</script>',
  '<img src="x" onerror="window.__pwned = \'onerror\'">',
  '',
  '[Run this](javascript:window.__pwned="link")',
  '',
  '![Latency chart](http://127.0.0.1:9/latency.png)',
  '',
  'The rest of the description still reads.',
].join('\n');

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [
    {
      number: 301,
      title: 'Roll out cancellation behind a flag',
      headRefName: 'rollout',
      author: 'alex',
      body: BODY,
    },
  ],
};

test.use({ fakeGitHub: GITHUB, repo: { worktrees: [{ branch: 'rollout' }] } });

/** Record what the app hands the system browser, instead of opening it. */
async function captureExternal(app: ElectronApplication) {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { opened?: string[] }).opened = opened;
    shell.openExternal = (url: string) => {
      opened.push(url);
      return Promise.resolve();
    };
  });
  return () =>
    app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []);
}

function pwned(page: Page) {
  return page.evaluate(() => (window as { __pwned?: string }).__pwned);
}

async function openDescription(page: Page) {
  await sidebarRow(page, /#301/).first().click();
  const description = page.getByRole('region', { name: 'Description' });
  await expect(description).toContainText('The rest of the description');
  return description;
}

test.describe('Pull request description', () => {
  test('keeps a disclosure closed until the reader opens it, by keyboard', async ({
    desktop,
  }) => {
    const description = await openDescription(desktop.page);
    const summary = description.locator('summary', {
      hasText: 'Rollout plan',
    });
    await expect(summary).toBeVisible();
    await expect(description.getByText('Ship behind the flag')).toBeHidden();

    await summary.focus();
    await desktop.page.keyboard.press('Enter');
    await expect(description.getByText('Ship behind the flag')).toBeVisible();
  });

  test('puts its headings below the section heading', async ({ desktop }) => {
    const description = await openDescription(desktop.page);
    await expect(
      description.getByRole('heading', { level: 3, name: 'Rollout' })
    ).toBeVisible();
    await expect(
      description.getByRole('heading', { level: 1, name: 'Rollout' })
    ).toHaveCount(0);
  });

  test('opens a repository path at the pull request’s commit', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    const opened = await captureExternal(app);
    const description = await openDescription(page);
    const link = description.getByRole('link', { name: 'the retry notes' });
    const target = `https://github.com/n10/fixture/blob/${HEAD}/docs/retry.md`;
    await expect(link).toHaveAttribute('title', target);
    await link.click();
    await expect.poll(opened).toEqual([target]);
  });

  test('runs none of the markup, and opens no script link', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    const opened = await captureExternal(app);
    const description = await openDescription(page);
    await expect(description.locator('script')).toHaveCount(0);
    await expect(description.locator('[onerror]')).toHaveCount(0);

    // The script address is dropped, so this is not a link at all.
    await expect(description.locator('a[href^="javascript" i]')).toHaveCount(0);
    await description.getByText('Run this').click();
    expect(await pwned(page)).toBeUndefined();
    expect(await opened()).toEqual([]);
  });

  test('shows an image it cannot load as that, with Retry, beside the text', async ({
    desktop,
  }) => {
    const description = await openDescription(desktop.page);
    const failed = description.getByText("Couldn't load “Latency chart”");
    await expect(failed).toBeVisible();
    await expect(
      failed.locator('..').getByRole('button', { name: 'Retry' })
    ).toBeVisible();
    await expect(
      description.getByText('The rest of the description still reads.')
    ).toBeVisible();
  });
});
