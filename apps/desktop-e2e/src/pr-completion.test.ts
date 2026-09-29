import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebar, sidebarRow } from './setup/app.js';
import { updateFakeGh, type FakeGitHub } from './setup/fake-gh.js';

/**
 * The Overview's Completion section and the check list nested in it
 * (spec O8/O9, fixture Q5): GitHub's verdict in one sentence with who
 * can act, one row per fact, and every check in the order that
 * matters. Nothing here is decided by the renderer: it shows core's
 * readiness.
 */

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  rules: { required: ['build', 'e2e'], conversationResolution: true },
  prs: [
    {
      number: 214,
      title: 'Handle cancelled requests',
      headRefName: 'cancel-requests',
      author: 'alex',
      body: Array.from({ length: 40 }, (_, i) => `Line ${i + 1}.`).join('\n\n'),
      mergeStateStatus: 'BLOCKED',
      reviewDecision: 'APPROVED',
      checks: [
        { name: 'build', state: 'FAILURE', required: true },
        { name: 'lint', state: 'IN_PROGRESS', required: true },
        { name: 'docs', state: 'FAILURE', required: false },
        { name: 'deploy/preview', state: 'SUCCESS', status: true },
      ],
      threads: [
        {
          path: 'src/request.ts',
          line: 1,
          comments: [{ author: 'bea', body: 'Is the timer cleared?' }],
        },
      ],
    },
    {
      number: 215,
      title: 'Tidy the retry helper',
      headRefName: 'tidy-retry',
      author: 'alex',
      mergeStateStatus: 'CLEAN',
      reviewDecision: 'APPROVED',
      checks: [
        { name: 'build', state: 'SUCCESS', required: true },
        { name: 'e2e', state: 'SUCCESS', required: true },
      ],
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: {
    worktrees: [{ branch: 'cancel-requests' }, { branch: 'tidy-retry' }],
  },
});

async function openPr(page: Page, row: RegExp): Promise<Locator> {
  await sidebarRow(page, row).first().click();
  const completion = page.getByRole('region', { name: 'Completion' });
  await expect(completion).toBeVisible({ timeout: 30_000 });
  return completion;
}

test.describe('Completion', () => {
  test('names what blocks first, and one row per fact', async ({ desktop }) => {
    const completion = await openPr(desktop.page, /#214/);
    const headline = completion.locator('[data-readiness-headline]');
    await expect(headline).toHaveAttribute(
      'data-readiness-headline',
      'blocked'
    );
    await expect(headline).toContainText('1 required check failing: build');
    // The blocker says what is wrong; who is to fix it adds nothing.
    await expect(headline).not.toContainText('can fix this');
    // Heard as a state, not only seen as a colour.
    await expect(headline.locator('.sr-only')).toHaveText(/^Blocked:/);
    const also = completion.getByRole('list', { name: 'Also blocking' });
    await expect(also).toContainText(
      'Waiting for 2 required checks: lint, e2e'
    );
    await expect(also).not.toContainText('Clears when');
    await expect(also).toContainText('1 unresolved conversation');
    // A failed optional check is visible, never a blocker.
    await expect(also).not.toContainText('docs');
    await expect(
      completion.locator('[data-readiness-row="checks"]')
    ).toContainText('1 required check failing: build');
    await expect(
      completion.locator('[data-readiness-row="reviews"]')
    ).toContainText('Approved');
  });

  test('says ready only where GitHub does', async ({ desktop }) => {
    const completion = await openPr(desktop.page, /#215/);
    await expect(
      completion.locator('[data-readiness-headline="ready"]')
    ).toContainText('Ready to merge');
  });

  test('shows the list’s facts, never a verdict, when the checks cannot be read', async ({
    desktop,
  }) => {
    updateFakeGh(desktop.homeDir, (s) => {
      s.prs[1].failing = { checks: true };
    });
    const completion = await openPr(desktop.page, /#215/);
    await expect(completion).toContainText('May not be ready to merge');
    await expect(
      completion.getByRole('button', { name: 'Refresh' })
    ).toBeVisible();
    await expect(
      completion.getByRole('button', { name: /View checks/ })
    ).toHaveCount(0);

    // Once it can be read, Refresh shows GitHub's verdict.
    updateFakeGh(desktop.homeDir, (s) => {
      s.prs[1].failing = undefined;
    });
    await completion.getByRole('button', { name: 'Refresh' }).click();
    await expect(completion).toContainText('Ready to merge');
    // Refresh went with the unknown; the keyboard moves beside where it
    // was, and the verdict is announced where it is shown.
    await expect(
      completion.getByRole('button', { name: /View checks/ })
    ).toBeFocused();
  });

  test('leaves the keyboard where the reader moved it', async ({ desktop }) => {
    const { page } = desktop;
    updateFakeGh(desktop.homeDir, (s) => {
      s.prs[1].failing = { checks: true };
    });
    const completion = await openPr(page, /#215/);
    const refresh = completion.getByRole('button', { name: 'Refresh' });
    // A refresh that still cannot read the checks leaves it unknown.
    await refresh.click();
    await expect(refresh).toHaveAttribute('aria-disabled', 'false');
    await expect(completion).toContainText('May not be ready to merge');

    updateFakeGh(desktop.homeDir, (s) => {
      s.prs[1].failing = undefined;
    });
    const header = page.getByRole('button', {
      name: 'Refresh this pull request',
    });
    await header.click();
    await expect(completion).toContainText('Ready to merge');
    await expect(header).toBeFocused();
  });

  test('leaves the keyboard alone once a refresh has settled', async ({
    desktop,
  }) => {
    const { page } = desktop;
    updateFakeGh(desktop.homeDir, (s) => {
      s.prs[1].failing = { checks: true };
    });
    const completion = await openPr(page, /#215/);
    const refresh = completion.getByRole('button', { name: 'Refresh' });
    // A refresh that comes back still unknown settles the press.
    await refresh.click();
    await expect(refresh).toHaveAttribute('aria-disabled', 'false');
    await expect(completion).toContainText('May not be ready to merge');
    // The reader clicks away, and later the list moves on its own.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    updateFakeGh(desktop.homeDir, (s) => {
      s.prs[1].failing = undefined;
      s.prs[1].threads = [
        {
          path: 'src/request.ts',
          line: 1,
          comments: [{ author: 'bea', body: 'Nit.' }],
        },
      ];
    });
    await sidebar(page)
      .getByRole('button', { name: 'Refresh', exact: true })
      .evaluate((el: HTMLElement) => el.click());
    await expect(completion).toContainText('Ready to merge');
    // That verdict was not the reader's refresh: the keyboard stays put.
    await expect(
      completion.getByRole('button', { name: /View checks/ })
    ).not.toBeFocused();
  });

  test('lists every check in the order that matters, and Back returns where the reader was', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const completion = await openPr(page, /#214/);
    const pane = completion.locator(
      'xpath=ancestor::*[contains(@class,"overflow-auto")][1]'
    );
    await pane.evaluate((el) => el.scrollTo({ top: 120 }));
    const before = await pane.evaluate((el) => el.scrollTop);

    const view = completion.getByRole('button', { name: /View checks/ });
    await expect(view).toHaveText(/View checks · 1 of 5 passed/);
    await view.click();
    await expect(
      page.getByRole('heading', { name: 'Checks and policies' })
    ).toBeFocused();

    const rows = page.getByRole('list', { name: 'Checks and policies' });
    const standing = await rows
      .locator('[data-check]')
      .evaluateAll((els) =>
        els.map((el) => [
          el.querySelector('.font-medium')?.textContent,
          el.getAttribute('data-check-standing'),
        ])
      );
    expect(standing).toEqual([
      ['build', 'blocking'],
      ['e2e', 'waiting'],
      ['lint', 'waiting'],
      ['docs', 'advisory'],
      ['deploy/preview', 'passed'],
    ]);
    // The expected one says what would count for it.
    await expect(rows.locator('[data-check^="expected:"]')).toContainText(
      'Must come from github-actions'
    );
    await expect(
      rows.getByRole('button', { name: 'Open build' })
    ).toBeVisible();
    // Each says what it tested: a run on the pull request tested the
    // head through a merge; a commit status, the head alone.
    const named = (name: string) =>
      rows.locator('[data-check]', {
        has: page.locator('.font-medium', { hasText: new RegExp(`^${name}$`) }),
      });
    await expect(named('build')).toContainText('fffffff · test merge');
    await expect(named('deploy/preview')).toContainText('fffffff');
    await expect(named('deploy/preview')).not.toContainText('test merge');

    await page.getByRole('button', { name: 'Back to the Overview' }).click();
    await expect(view).toBeFocused();
    expect(await pane.evaluate((el) => el.scrollTop)).toBe(before);
  });

  test('refreshes a blocker in place, without moving the page', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const completion = await openPr(page, /#214/);
    const headline = completion.locator('[data-readiness-headline]');
    // The reader is reading Completion: it is the top of what is in view,
    // which the browser keeps still when anything above it changes height.
    await completion.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const top = () =>
      completion.evaluate((el) => el.getBoundingClientRect().top);
    const before = await top();
    // The list's refresh, outside the pane the reader has scrolled: the
    // row moving is what reads the checks again.
    const refresh = () =>
      sidebar(page)
        .getByRole('button', { name: 'Refresh', exact: true })
        .click();

    updateFakeGh(desktop.homeDir, (s) => {
      const build = s.prs[0].checks?.find((c) => c.name === 'build');
      if (build) build.state = 'SUCCESS';
      s.prs[0].rollup = 'PENDING';
    });
    await refresh();
    // What won't clear by waiting leads: the conversation, not the
    // checks still running.
    await expect(headline).toContainText('1 unresolved conversation');
    await expect(
      completion.locator('[data-readiness-row="checks"]')
    ).toContainText('Waiting for 2 required checks: lint, e2e');
    expect(await top()).toBe(before);

    // With the thread resolved, what is left clears by itself.
    updateFakeGh(desktop.homeDir, (s) => {
      const thread = s.prs[0].threads?.[0];
      if (thread) thread.isResolved = true;
    });
    await refresh();
    await expect(headline).toContainText(
      'Waiting for 2 required checks: lint, e2e'
    );
    await expect(headline.locator('.sr-only')).toHaveText(/^Waiting:/);
    expect(await top()).toBe(before);
  });

  test('keeps what it read when a re-read fails, in the list and out of it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const completion = await openPr(page, /#214/);
    await completion.getByRole('button', { name: /View checks/ }).click();
    const rows = page.getByRole('list', { name: 'Checks and policies' });
    await expect(rows.locator('[data-check]')).toHaveCount(5);

    // The pull request's own Refresh sits beside Back, and the read it
    // asks for fails.
    updateFakeGh(desktop.homeDir, (s) => {
      s.prs[0].failing = { checks: true };
    });
    await page
      .getByRole('button', { name: 'Refresh this pull request' })
      .click();
    // The reader stays where they were, with the list they had and why
    // it is not newer.
    await expect(
      page.getByRole('status').filter({ hasText: 'Showing the checks from' })
    ).toContainText('Refreshing failed');
    await expect(rows.locator('[data-check]')).toHaveCount(5);

    await page.getByRole('button', { name: 'Back to the Overview' }).click();
    await expect(
      completion
        .getByRole('status')
        .filter({ hasText: 'Showing the completion from' })
    ).toBeVisible();
    await expect(completion.locator('[data-readiness-headline]')).toContainText(
      '1 required check failing: build'
    );
  });

  test('keeps the reader in the list when a push cannot be read', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const completion = await openPr(page, /#214/);
    await completion.getByRole('button', { name: /View checks/ }).click();
    const heading = page.getByRole('heading', { name: 'Checks and policies' });
    await expect(heading).toBeFocused();

    updateFakeGh(desktop.homeDir, (s) => {
      s.prs[0].headRefOid = 'e'.repeat(40);
      s.prs[0].failing = { checks: true };
    });
    await sidebar(page)
      .getByRole('button', { name: 'Refresh', exact: true })
      .click();
    // Nothing was read at the new head: the list says so, where it was.
    await expect(
      page.getByRole('status').filter({ hasText: "Couldn't load the checks" })
    ).toBeVisible();
    await expect(heading).toBeVisible();
    await page.getByRole('button', { name: 'Back to the Overview' }).click();
    await expect(completion).toContainText('May not be ready to merge');
  });

  test('reads the checks again when the list row moves at the same head', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const completion = await openPr(page, /#214/);
    const also = completion.getByRole('list', { name: 'Also blocking' });
    await expect(also).toContainText('1 unresolved conversation');

    updateFakeGh(desktop.homeDir, (s) => {
      const thread = s.prs[0].threads?.[0];
      if (thread) thread.isResolved = true;
    });
    // Only the list is read again: its count moved, so the checks are.
    await sidebar(page)
      .getByRole('button', { name: 'Refresh', exact: true })
      .click();
    await expect(also).not.toContainText('unresolved conversation');
  });

  test('reads the checks again after a push, and says which head it shows', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const completion = await openPr(page, /#215/);
    const headline = completion.locator('[data-readiness-headline]');
    const source = completion.locator('[data-readiness-source]');
    await expect(headline).toContainText('Ready to merge');
    await expect(source).toContainText('On fffffff');

    updateFakeGh(desktop.homeDir, (s) => {
      const pr = s.prs[1];
      pr.headRefOid = 'e'.repeat(40);
      pr.mergeStateStatus = 'BLOCKED';
      pr.checks = [
        { name: 'build', state: 'IN_PROGRESS', required: true },
        { name: 'e2e', state: 'SUCCESS', required: true },
      ];
    });
    // Only the list is read again; the new head is what reads the checks.
    await sidebar(page)
      .getByRole('button', { name: 'Refresh', exact: true })
      .click();
    await expect(headline).toContainText('Waiting for 1 required check: build');
    await expect(source).toContainText('On eeeeeee');
  });
});
