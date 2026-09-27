import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow, visibleText } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';
import { armContextMenuChoice } from './setup/menu.js';

/**
 * The pull request Overview (spec O1/O9, fixture Q1): which pane a
 * pull request opens on, what the Overview says about it, and the
 * header that stays readable as the window narrows.
 */

const LONG_TITLE =
  'Handle cancelled requests without leaking the socket, the retry timer or the half-written cache entry';

const BODY = [
  '## Why',
  '',
  'A cancelled request kept its socket open until the server gave up.',
  '',
  '## Verification',
  '',
  '- [x] Unit tests cover cancel before connect',
  '- [ ] Soak test on staging',
  '',
  '| Case | Before | After |',
  '| --- | --- | --- |',
  '| cancel | leak | closed |',
].join('\n');

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [
    {
      number: 214,
      title: LONG_TITLE,
      headRefName: 'cancel-requests',
      author: 'alex',
      body: BODY,
      rollup: 'SUCCESS',
      reviews: [{ author: 'bea', state: 'APPROVED' }],
      reviewRequests: ['n10-tester'],
    },
    {
      number: 215,
      title: 'Tidy the retry helper',
      headRefName: 'tidy-retry',
      body: 'Small cleanup.',
      threads: [
        {
          id: 'T1',
          path: 'retry.ts',
          line: 1,
          comments: [{ author: 'bea', body: 'Why keep the old name?' }],
        },
      ],
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: {
    worktrees: [
      {
        branch: 'cancel-requests',
        files: {
          'request.ts': 'export function cancel() {\n  socket.close();\n}\n',
        },
      },
      {
        branch: 'tidy-retry',
        files: { 'retry.ts': 'export const retryDelay = 100;\n' },
      },
    ],
  },
});

/** The pull request tab's own header, not the Overview's title block. */
function prHeader(page: Page): Locator {
  return page.locator('header').filter({
    has: page.getByRole('button', { name: 'Refresh this pull request' }),
  });
}

function overviewTitle(page: Page, title: string): Locator {
  return page.getByRole('heading', { level: 1, name: new RegExp(title) });
}

/** Where an element's top edge sits on screen. */
async function top(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('The element is not on screen');
  return box.y;
}

async function openPr(page: Page, row: RegExp): Promise<void> {
  await sidebarRow(page, row).first().click();
  await expect(prHeader(page)).toBeVisible({ timeout: 30_000 });
}

test.describe('Pull request Overview', () => {
  test("opens someone else's pull request on its Overview, with the next step first", async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page, /#214/);

    await expect(
      overviewTitle(page, 'Handle cancelled requests')
    ).toBeVisible();
    const next = page.getByRole('region', { name: 'Next step' });
    await expect(next).toContainText('Your review is requested');
    await expect(
      next.getByRole('button', { name: 'Review changes' })
    ).toBeVisible();

    // The author's description is the context, read in full.
    await expect(
      page.getByRole('heading', { name: 'Verification' })
    ).toBeVisible();

    // Everything n10 can see is green, and it still does not say ready.
    await expect(
      page.getByRole('region', { name: 'Completion' })
    ).toContainText('Readiness not fully known');
    await expect(page.locator('[data-reviewer="bea"]')).toContainText(
      'Approved'
    );
  });

  test('Review changes shows the diff', async ({ desktop }) => {
    const { page } = desktop;
    await openPr(page, /#214/);

    await page.getByRole('button', { name: 'Review changes' }).click();

    await expect(visibleText(page, 'socket.close();')).toBeVisible();
    await expect(overviewTitle(page, 'Handle cancelled requests')).toBeHidden();
  });

  test('opens your own pull request on its diff', async ({ desktop }) => {
    const { page } = desktop;
    await openPr(page, /#215/);

    await expect(visibleText(page, 'retryDelay')).toBeVisible();
    await expect(overviewTitle(page, 'Tidy the retry helper')).toBeHidden();
  });

  test('sends an author to the thread waiting on them', async ({ desktop }) => {
    const { page } = desktop;
    await openPr(page, /#215/);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();

    const next = page.getByRole('region', { name: 'Next step' });
    await expect(next).toContainText('1 unresolved thread');
    await next.getByRole('button', { name: 'Respond to feedback' }).click();

    // The thread's card in the diff, not its row in the rail.
    await expect(
      page.locator('[data-thread]', { hasText: 'Why keep the old name?' })
    ).toBeVisible();
  });

  test('copies the link from the native More menu', async ({ desktop }) => {
    const { app, page } = desktop;
    await openPr(page, /#214/);

    await armContextMenuChoice(app, 'Copy Link');
    await prHeader(page).getByRole('button', { name: 'More actions' }).click();

    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('https://github.com/n10/fixture/pull/214');
  });

  test('keeps the number and state in view at a narrow width', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await openPr(page, /#214/);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setMinimumSize(0, 0);
      window.setContentSize(800, 600);
    });

    const header = prHeader(page);
    await expect(header.getByText('#214', { exact: true })).toBeVisible();
    await expect(
      header.locator('[data-slot="badge"]', { hasText: 'Open' })
    ).toBeVisible();
    // Checks and reviews give way to the title, which is cut short here…
    await expect(header.locator('[data-reviewer-summary]')).toBeHidden();
    await expect(header.getByText('CI succeeded')).toBeHidden();
    // …but the Overview carries it whole, and in one column: the next
    // step and readiness come before the description.
    await expect(overviewTitle(page, LONG_TITLE)).toBeVisible();
    const readiness = page.getByRole('region', { name: 'Completion' });
    const description = page.getByRole('region', { name: 'Description' });
    expect(await top(readiness)).toBeLessThan(await top(description));
  });
});
