import type { ElectronApplication, Locator, Page } from '@playwright/test';
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
  '| Case | Before | After | Socket | Timer | Cache | Retries |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| `cancelBeforeConnect` | `leakedUntilServerTimeout` | `closedImmediatelyOnCancel` | `requestSocketCancellationRegression` | cleared | untouched | none |',
  '| cancel mid-response | leaked until the server gave up | closed after flush | closed | cleared | entry discarded | none |',
  '',
  'Trace: https://traces.example.com/sessions/cancelled-request-socket-leak/spans/0123456789abcdef',
  '',
  'Digest 9f2c1e7a4b8d3f60c5e1a2b7d9043e6f8a1c2b3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f',
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

async function resize(
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setMinimumSize(0, 0);
      window.setContentSize(w, h);
    },
    [width, height]
  );
}

/** Where an element stops being visible on the right: its own edge,
 *  cut by every scrolling or clipping box it sits in, up to the pane. */
function visibleRight(el: Element): number {
  let right = el.getBoundingClientRect().right;
  for (let box = el.parentElement; box; box = box.parentElement) {
    if (getComputedStyle(box).overflowX !== 'visible') {
      right = Math.min(right, box.getBoundingClientRect().right);
    }
    if (box.classList.contains('@container')) break;
  }
  return right;
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

  test('Review changes shows the diff and takes the keyboard there', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page, /#214/);

    await page.getByRole('button', { name: 'Review changes' }).focus();
    await page.keyboard.press('Enter');

    await expect(visibleText(page, 'socket.close();')).toBeVisible();
    await expect(overviewTitle(page, 'Handle cancelled requests')).toBeHidden();
    // Not left on the hidden button: the next key acts on the changes.
    await expect(page.getByRole('region', { name: 'Changes' })).toBeFocused();
  });

  test('opens your own pull request on its diff', async ({ desktop }) => {
    const { page } = desktop;
    await openPr(page, /#215/);

    await expect(visibleText(page, 'retryDelay')).toBeVisible();
    await expect(overviewTitle(page, 'Tidy the retry helper')).toBeHidden();
  });

  test('sends an author to the first unresolved thread, and the keyboard with it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page, /#215/);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();

    const next = page.getByRole('region', { name: 'Next step' });
    await expect(next).toContainText('1 unresolved thread');
    await next.getByRole('button', { name: 'Respond to feedback' }).focus();
    await page.keyboard.press('Enter');

    // The navigator went to the thread, and the keyboard with it.
    await expect(
      page.locator('[data-comment-row][aria-current="true"]')
    ).toContainText('Why keep the old name?');
    await expect(
      page.locator('[data-thread]', { hasText: 'Why keep the old name?' })
    ).toBeFocused();
  });

  test('leaves the keyboard on a rail row that opens a thread', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page, /#215/);
    const row = page.locator('[data-comment-row]').first();
    await row.focus();
    await page.keyboard.press('Enter');
    // The thread opens beside it, but the reader is still arrowing
    // through the list.
    await expect(
      page.locator('[data-thread]', { hasText: 'Why keep the old name?' })
    ).toBeVisible();
    await expect(row).toBeFocused();
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

  test('says where reviews stand in words at 1024×768', async ({ desktop }) => {
    const { app, page } = desktop;
    await openPr(page, /#214/);
    await resize(app, 1024, 768);
    await page.getByRole('button', { name: 'Hide sidebar' }).click();

    const header = prHeader(page);
    await expect(header.locator('[data-reviewer-summary]')).toHaveText(
      '1/2 approved'
    );
    await expect(
      header.getByRole('button', { name: 'Open worktree in editor' })
    ).toBeVisible();
    await expect(
      header.getByRole('button', { name: 'Open on GitHub' })
    ).toBeVisible();
    // An approval beside a pending request is counted, not called met.
    await expect(page.locator('[data-readiness-row="reviews"]')).toContainText(
      'Approved by bea · 1 pending'
    );
  });

  test('keeps a wide table and a long link inside the reading column', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await openPr(page, /#214/);
    await resize(app, 1360, 860);
    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    // The header has room for the branches here, read as one name.
    await expect(
      prHeader(page).getByRole('button', {
        name: 'cancel-requests → main',
        exact: true,
      })
    ).toBeVisible();

    const completion = page.getByRole('region', { name: 'Completion' });
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    const completionBox = await completion.boundingBox();
    // The table scrolls in its own box, so what shows of it ends before
    // the context column starts…
    const shownRight = await table.evaluate(visibleRight);
    expect(shownRight).toBeLessThanOrEqual(completionBox?.x ?? 0);
    // …a long unbroken digest wraps within the column…
    const digestRight = await page.getByText(/^Digest /).evaluate((el) => {
      const text = document.createRange();
      text.selectNodeContents(el);
      return text.getBoundingClientRect().right;
    });
    expect(digestRight).toBeLessThanOrEqual(completionBox?.x ?? 0);
    // …and nothing scrolls the Overview itself sideways.
    const sideways = await completion.evaluate((el) => {
      const pane = el.closest('.overflow-auto');
      return pane ? pane.scrollWidth - pane.clientWidth : -1;
    });
    expect(sideways).toBe(0);
  });

  test('keeps the number and state in view at a narrow width', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await openPr(page, /#214/);
    await resize(app, 800, 600);

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
