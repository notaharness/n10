import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow, visibleText } from './setup/app.js';
import type { FakeAzureDevOps } from './setup/fake-ado.js';

/**
 * The Azure DevOps provider, end to end against the fake
 * (`fixtures/fake-ado.ts`): the real provider and draft poster, PAT
 * header and all, talking HTTP to a loopback server instead of
 * dev.azure.com.
 */

const BRANCH = 'undo-support';
const QUESTION = 'Should the undo stack be bounded?';
const DRAFT = 'The undo stack is never bounded.';
const TEAM = '[n10-project]\\Core Team';

const AZURE: FakeAzureDevOps = {
  user: { displayName: 'N10 Tester', uniqueName: 'n10-tester@example.com' },
  prs: [
    {
      id: 101,
      title: 'Add undo support',
      sourceBranch: BRANCH,
      description: 'Adds an undo stack.',
      iterations: 2,
      // A team approved by one of its members: Azure lists the team's
      // row with the member's vote, and the member's row names the team
      // in `votedFor`.
      reviewers: [
        { name: 'Core Team', isContainer: true, vote: 10, isRequired: true },
        { name: 'Teammate', vote: 10, votedFor: ['Core Team'] },
        { name: 'Bob Reviewer', vote: 0 },
      ],
      threads: [
        { system: true, comments: [{ author: 'Teammate', body: 'voted 10' }] },
        {
          path: 'undo.c',
          line: 1,
          comments: [{ author: 'Teammate', body: QUESTION }],
        },
      ],
      policies: [
        { name: 'Minimum number of reviewers', status: 'approved' },
        { name: 'Build', status: 'running' },
      ],
    },
    {
      id: 102,
      title: 'Tidy the parser',
      sourceBranch: 'parser-tidy',
      author: 'Alice Author',
      reviewers: [{ name: 'N10 Tester', uniqueName: 'n10-tester@example.com' }],
    },
  ],
};

test.use({
  fakeAzureDevOps: AZURE,
  drafts: {
    101: [
      {
        id: 'd1',
        file: 'undo.c',
        lineStart: 2,
        lineEnd: 2,
        severity: 'major',
        body: DRAFT,
        side: 'RIGHT',
        status: 'draft',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  },
  repo: {
    branches: ['parser-tidy'],
    worktrees: [
      {
        branch: BRANCH,
        files: { 'undo.c': 'void undo(void) {}\nint depth;\n' },
      },
    ],
  },
});

async function openPr(page: Page) {
  await sidebarRow(page, /Add undo support/)
    .first()
    .click();
  await expect(visibleText(page, QUESTION)).toBeVisible({ timeout: 30_000 });
}

test.describe('Azure DevOps', () => {
  test('the sidebar lists the active pull requests', async ({ desktop }) => {
    const { page } = desktop;
    await expect(sidebarRow(page, /Add undo support/).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(sidebarRow(page, /Tidy the parser/).first()).toBeVisible();
    // Every listed row counts toward the tally, the team's included.
    await expect(
      sidebarRow(page, /Add undo support/)
        .first()
        .getByText('2/3')
    ).toBeVisible();
  });

  test('an open pull request shows its reviewers and the team vote', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);

    for (const name of [TEAM, 'Teammate', 'Bob Reviewer']) {
      await expect(
        page.getByTitle(name, { exact: true }).first()
      ).toBeVisible();
    }
    // Azure names a team reviewer `[project]\team`; its row carries the
    // vote its member cast for it.
    await page.getByTitle(TEAM, { exact: true }).first().hover();
    await expect(page.getByRole('tooltip')).toHaveText(`${TEAM}: approved`);

    // The team's row and the teammate who voted for it count as two
    // approvals here and `2/3` in the sidebar test. #194 counts the
    // pair once; both assertions change when it lands.
    await page.getByRole('button', { name: /Overview/ }).click();
    await expect(visibleText(page, '2 approved')).toBeVisible();
  });

  test('posting a draft creates a thread on the pull request', async ({
    desktop,
    fakeAdo,
  }) => {
    const { page } = desktop;
    await openPr(page);

    const draft = page.locator('[data-draft="d1"]');
    await draft.scrollIntoViewIfNeeded();
    await draft.getByRole('button', { name: 'Post', exact: true }).click();

    await expect(
      page.locator('[data-thread]').filter({ hasText: DRAFT })
    ).toBeVisible({ timeout: 30_000 });
    await expect(draft).toHaveCount(0);

    const posted = fakeAdo?.requests.find(
      (r) => r.method === 'POST' && r.path.endsWith('/pullrequests/101/threads')
    );
    expect(posted?.body).toMatchObject({
      threadContext: { filePath: '/undo.c', rightFileStart: { line: 2 } },
      status: 1,
    });
  });
});
