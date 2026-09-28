import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
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
  test('names what blocks first, who can clear it, and one row per fact', async ({
    desktop,
  }) => {
    const completion = await openPr(desktop.page, /#214/);
    const headline = completion.locator('[data-readiness-headline]');
    await expect(headline).toHaveAttribute(
      'data-readiness-headline',
      'blocked'
    );
    await expect(headline).toContainText('1 required check failing: build');
    await expect(headline).toContainText('The author can fix this');
    const also = completion.getByRole('list', { name: 'Also blocking' });
    await expect(also).toContainText(
      'Waiting for 2 required checks: lint, e2e · Clears when the checks finish'
    );
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
    await expect(completion).toContainText('Readiness not fully known');
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
    const pane = completion.locator(
      'xpath=ancestor::*[contains(@class,"overflow-auto")][1]'
    );
    await pane.evaluate((el) => el.scrollTo({ top: 120 }));
    const before = await pane.evaluate((el) => el.scrollTop);

    updateFakeGh(desktop.homeDir, (s) => {
      const build = s.prs[0].checks?.find((c) => c.name === 'build');
      if (build) build.state = 'SUCCESS';
    });
    await page
      .getByRole('button', { name: 'Refresh this pull request' })
      .click();
    await expect(completion.locator('[data-readiness-headline]')).toContainText(
      'Waiting for 2 required checks: lint, e2e'
    );
    expect(await pane.evaluate((el) => el.scrollTop)).toBe(before);
  });
});
