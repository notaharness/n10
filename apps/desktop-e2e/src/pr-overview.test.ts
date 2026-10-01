import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  showChanges,
  sidebarRow,
  visibleText,
} from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';
import { armContextMenuChoice } from './setup/menu.js';

/**
 * The pull request Overview (spec O1/O9, fixture Q1): which pane a
 * pull request opens on, what the Overview says about it, the header
 * the other panes keep and that stays readable as the window narrows,
 * and the way back up to the review from the agent's terminal.
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
      // GitHub's own word: one approval is not the two the rules want.
      mergeStateStatus: 'BLOCKED',
      reviewDecision: 'REVIEW_REQUIRED',
      checks: [{ name: 'build', state: 'SUCCESS', required: true }],
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

/** The pull request tab's header bar, which every pane but the Overview
 *  has: the Overview is headed by its own title block. */
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

/** Turn the wheel over an element and wait until the page has seen it
 *  and painted twice: long enough for any scroll it starts to show. */
async function wheelOver(locator: Locator, dy: number): Promise<void> {
  const page = locator.page();
  await locator.hover();
  // Listening before the wheel turns; a handle, so the promise is not
  // awaited here.
  const seen = await page.evaluateHandle(() => ({
    painted: new Promise<void>((resolve) =>
      addEventListener(
        'wheel',
        () =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        { once: true, passive: true }
      )
    ),
  }));
  await page.mouse.wheel(0, dy);
  await seen.evaluate((s) => s.painted);
}

async function openPr(page: Page, row: RegExp): Promise<void> {
  await sidebarRow(page, row).first().click();
  // In the header bar, or beside the Overview's title.
  await expect(
    page.getByRole('button', { name: 'Refresh this pull request' })
  ).toBeVisible({ timeout: 30_000 });
}

async function agentReady(page: Page): Promise<void> {
  await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
    timeout: 30_000,
  });
}

/** The header's Back, up from the pane showing. */
async function backToReview(page: Page): Promise<void> {
  await prHeader(page).getByRole('button', { name: 'Back to review' }).click();
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
    // Headed by its own title, with the pull request's actions beside it,
    // and no header bar above.
    await expect(prHeader(page)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Open on GitHub' })
    ).toBeVisible();
    const next = page.getByRole('region', { name: 'Next step' });
    await expect(next).toContainText('Your review is requested');
    // One way in to a review: Review changes, and no instant vote.
    await expect(
      next.getByRole('button', { name: 'Review changes' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Request changes' })
    ).toHaveCount(0);
    await expect(page.getByText('A vote posts to GitHub at once')).toHaveCount(
      0
    );

    // The author's description is the context, read in full.
    await expect(
      page.getByRole('heading', { name: 'Verification' })
    ).toBeVisible();

    // Everything else is green; GitHub still wants a review, and the
    // reader is asked for it.
    const completion = page.getByRole('region', { name: 'Completion' });
    await expect(completion).toContainText('Waiting for review');
    await expect(completion).toContainText('Waiting for your review');
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
    // The changes keep the header bar, and it has no CI badge: CI is
    // Completion's, and the sidebar row's. Its Back leads up to the
    // Overview.
    await expect(prHeader(page)).toBeVisible();
    await expect(prHeader(page).getByText(/^CI /)).toHaveCount(0);
    await expect(
      prHeader(page).getByRole('button', { name: 'Back to review' })
    ).toBeVisible();
    // Not left on the hidden button: the next key acts on the changes.
    await expect(page.getByRole('region', { name: 'Changes' })).toBeFocused();
  });

  test('opens your own pull request on its Overview too, and Back goes up to it from the diff', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page, /#215/);
    await expect(overviewTitle(page, 'Tidy the retry helper')).toBeVisible();

    await showChanges(page);
    await expect(visibleText(page, 'retryDelay')).toBeVisible();
    await expect(overviewTitle(page, 'Tidy the retry helper')).toBeHidden();
    // The rail lists neither the Overview nor the comments: Back leads
    // to the one, and the other is the Overview's and the diff's.
    await expect(
      page.locator('[data-thread]', { hasText: 'Why keep the old name?' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Overview', exact: true })
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Comments/ })).toHaveCount(
      0
    );

    const back = prHeader(page).getByRole('button', { name: 'Back to review' });
    await back.focus();
    await page.keyboard.press('Enter');
    const title = overviewTitle(page, 'Tidy the retry helper');
    await expect(title).toBeVisible();
    await expect(title).toBeFocused();
  });

  test('sends an author to the first unresolved thread, and the keyboard with it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page, /#215/);

    const next = page.getByRole('region', { name: 'Next step' });
    await expect(next).toContainText('1 unresolved thread');
    await next.getByRole('button', { name: 'Respond to feedback' }).focus();
    await page.keyboard.press('Enter');

    // The diff went to the thread, and the keyboard with it.
    await expect(
      page.locator('[data-thread]', { hasText: 'Why keep the old name?' })
    ).toBeFocused();
  });

  test.describe('with an open thread', () => {
    test.use({
      fakeGitHub: {
        ...GITHUB,
        prs: [
          {
            ...GITHUB.prs[0],
            threads: [
              {
                id: 'T9',
                path: 'request.ts',
                line: 2,
                comments: [{ author: 'bea', body: 'Can this close twice?' }],
              },
            ],
          },
          GITHUB.prs[1],
        ],
      },
    });

    test('leads a reviewer from the unresolved count to the first open thread', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await openPr(page, /#214/);
      const next = page.getByRole('region', { name: 'Next step' });
      await next.getByRole('button', { name: '1 unresolved thread' }).click();

      await expect(
        page.locator('[data-thread]', { hasText: 'Can this close twice?' })
      ).toBeFocused();
    });
  });

  test('copies the link from the native More menu', async ({ desktop }) => {
    const { app, page } = desktop;
    await openPr(page, /#214/);

    await armContextMenuChoice(app, 'Copy Link');
    await page.getByRole('button', { name: 'More actions' }).click();

    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('https://github.com/n10/fixture/pull/214');
  });

  test.describe('with a long diff behind it', () => {
    test.use({
      repo: {
        worktrees: [
          {
            branch: 'cancel-requests',
            files: {
              'request.ts': Array.from(
                { length: 200 },
                (_, i) => `export const step${i} = ${i};`
              ).join('\n'),
            },
          },
          {
            branch: 'tidy-retry',
            files: { 'retry.ts': 'export const retryDelay = 100;\n' },
          },
        ],
      },
    });

    test('stays put under the wheel in a window taller than it', async ({
      desktop,
    }) => {
      const { app, page } = desktop;
      await resize(app, 1360, 1400);
      await openPr(page, /#214/);

      // The Overview fits, so it has nothing to scroll, and nothing
      // around it scrolls instead: not the diff kept behind it.
      const title = overviewTitle(page, 'Handle cancelled requests');
      await expect(title).toBeVisible();
      // The diff behind it has its lines, or there is nothing to spill.
      // Hidden, so not a role query; this tab's pane, not a spare's.
      const hiddenDiff = page
        .locator('[data-terminal-pane]')
        .filter({ has: title })
        .locator('[data-diff-scroll]');
      await expect
        .poll(() =>
          hiddenDiff.evaluate((el) => el.scrollHeight > el.clientHeight)
        )
        .toBe(true);
      const before = await top(title);
      await wheelOver(title, 600);
      expect(await top(title)).toBe(before);

      // The diff scrolled to its end takes the wheel no further.
      await showChanges(page);
      const changes = page.getByRole('region', { name: 'Changes' });
      await wheelOver(changes, 100_000);
      await expect
        .poll(() =>
          changes.evaluate(
            (el) => el.scrollHeight - el.clientHeight - el.scrollTop
          )
        )
        .toBeLessThan(1);
      const edge = await top(changes);
      await wheelOver(changes, 600);
      expect(await top(changes)).toBe(edge);
    });
  });

  test('says where reviews stand in words at 1024×768', async ({ desktop }) => {
    const { app, page } = desktop;
    await openPr(page, /#214/);
    await resize(app, 1024, 768);
    await page.getByRole('button', { name: 'Hide sidebar' }).click();

    // An approval beside a pending request is not called met: GitHub
    // still requires review.
    await expect(page.locator('[data-readiness-row="reviews"]')).toContainText(
      'Waiting for review'
    );
    await showChanges(page);
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
  });

  test('keeps a wide table and a long link inside the reading column', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await openPr(page, /#214/);
    await resize(app, 1360, 860);
    await page.getByRole('button', { name: 'Hide sidebar' }).click();

    const completion = page.getByRole('region', { name: 'Completion' });
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    const completionBox = await completion.boundingBox();
    // The context column leads with the reviewers, then completion.
    const reviewers = page.getByRole('region', { name: 'Reviewers' });
    expect(await top(reviewers)).toBeLessThan(completionBox?.y ?? 0);
    expect((await reviewers.boundingBox())?.x).toBe(completionBox?.x);
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

    // The changes' header has room for the branches here, read as one
    // name.
    await showChanges(page);
    await expect(
      prHeader(page).getByRole('button', {
        name: 'cancel-requests → main',
        exact: true,
      })
    ).toBeVisible();
  });

  test('keeps the number and state in view at a narrow width', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await openPr(page, /#214/);
    await resize(app, 800, 600);

    // The review rail folds away as its own control would, so the
    // content is not squeezed beside it, and comes back with room.
    const showRail = page.getByRole('button', { name: 'Show review sidebar' });
    const launch = page.getByRole('button', { name: 'Launch agent' });
    await expect(showRail).toBeVisible();
    await expect(launch).toBeHidden();

    // The Overview carries the title whole, and in one column: the
    // reviewers, then completion, come before the description…
    await expect(overviewTitle(page, LONG_TITLE)).toBeVisible();
    const reviewers = page.getByRole('region', { name: 'Reviewers' });
    const readiness = page.getByRole('region', { name: 'Completion' });
    const description = page.getByRole('region', { name: 'Description' });
    expect(await top(reviewers)).toBeLessThan(await top(readiness));
    expect(await top(readiness)).toBeLessThan(await top(description));

    // …while the changes' header cuts it short, keeping the number and
    // state, and letting reviews give way.
    await showChanges(page);
    const header = prHeader(page);
    await expect(header.getByText('#214', { exact: true })).toBeVisible();
    await expect(
      header.locator('[data-slot="badge"]', { hasText: 'Open' })
    ).toBeVisible();
    await expect(header.locator('[data-reviewer-summary]')).toBeHidden();

    await resize(app, 1360, 860);
    await expect(showRail).toHaveCount(0);
    await expect(launch).toBeVisible();
  });

  test('the terminal goes back up to the review it came from, and the keyboard with it', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await resize(app, 1360, 860);
    await openPr(page, /#214/);
    const back = prHeader(page).getByRole('button', { name: 'Back to review' });
    const pressBack = async () => {
      await back.focus();
      await page.keyboard.press('Enter');
    };

    // From the changes to the terminal, and Back to the changes.
    await showChanges(page);
    await launchAgentFromRail(page);
    await agentReady(page);
    // The terminal's bar is the changes' bar with Back in front: the
    // title keeps room to be read.
    const titleWidth = await prHeader(page)
      .getByText(LONG_TITLE)
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(titleWidth).toBeGreaterThanOrEqual(280);
    await pressBack();
    await expect(visibleText(page, 'socket.close();')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Changes' })).toBeFocused();

    // Up from the changes is the Overview, with the keyboard on its
    // heading.
    await pressBack();
    const title = overviewTitle(page, 'Handle cancelled requests');
    await expect(title).toBeFocused();

    // From the Overview to the terminal: Back goes to the Overview, the
    // last review pane shown, which has no header bar. The Agent card
    // says it is the pane showing only while its terminal is.
    const agent = page.getByRole('button', { name: /^Agent/ });
    await agent.click();
    await agentReady(page);
    await expect(agent).toHaveAttribute('aria-current', 'true');
    await pressBack();
    await expect(title).toBeVisible();
    await expect(title).toBeFocused();
    await expect(prHeader(page)).toHaveCount(0);
    await expect(agent).not.toHaveAttribute('aria-current');

    // The Overview showing its check list: Back returns to the list, and
    // the keyboard to its heading.
    await page
      .getByRole('region', { name: 'Completion' })
      .getByRole('button', { name: /View checks/ })
      .click();
    await agent.click();
    await agentReady(page);
    await pressBack();
    await expect(
      page.getByRole('heading', { name: 'Checks and policies' })
    ).toBeFocused();
  });

  test('goes up to the review, not back to the plan shown in between', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page, /#215/);
    await showChanges(page);
    const thread = page.locator('[data-thread]', {
      hasText: 'Why keep the old name?',
    });
    await thread.hover();
    await thread
      .getByRole('button', { name: 'Add to plan', exact: true })
      .click();

    // The Overview, then the plan, then the terminal.
    await backToReview(page);
    await page.getByRole('button', { name: /^Plan\b/ }).click();
    await expect(page.getByRole('region', { name: 'Plan' })).toBeVisible();
    await launchAgentFromRail(page);
    await agentReady(page);

    await prHeader(page)
      .getByRole('button', { name: 'Back to review' })
      .click();
    await expect(overviewTitle(page, 'Tidy the retry helper')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Plan' })).toBeHidden();
  });

  test('a worktree without a pull request has no review to go back to', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'plain-work');
    await launchAgentFromRail(page);
    await agentReady(page);
    await expect(
      page.getByRole('button', { name: 'Back to review' })
    ).toHaveCount(0);
  });
});
