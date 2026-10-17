import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import {
  fakeGhScenarioPath,
  updateFakeGh,
  type FakeGitHub,
} from './setup/fake-gh.js';

/**
 * Agent findings on a whole file and on the pull request itself: the
 * walkthrough shows where each goes without a snippet, and posting
 * files the one as a file comment and the other as the review's text.
 */

const BRANCH = 'anchors';
const FILE = 'src/retry.ts';
const finding = (id: string, body: string, anchor: object) => ({
  id,
  side: 'RIGHT',
  severity: 'major',
  body,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00Z',
  ...anchor,
});

test.use({
  fakeGitHub: {
    username: 'bea',
    prs: [
      {
        number: 77,
        title: 'Retry writes',
        headRefName: BRANCH,
        author: 'alex',
      },
    ],
  },
  repo: {
    baseFiles: { [FILE]: 'one\ntwo\n' },
    worktrees: [{ branch: BRANCH, files: { [FILE]: 'changed\ntwo\n' } }],
  },
  drafts: {
    77: [
      finding('on-file', 'The retry module has no tests.', {
        file: FILE,
        lineStart: null,
        lineEnd: null,
      }),
      finding('on-pr', 'Split the refactor from the fix.', {
        file: null,
        lineStart: null,
        lineEnd: null,
      }),
    ],
  },
});

const pane = (page: Page) => page.locator('[data-terminal-pane]');

async function openWalkthrough(page: Page) {
  await sidebarRow(page, /Retry writes|#77/)
    .first()
    .click();
  await page
    .getByRole('button', { name: /Review ready/ })
    .first()
    .click({ timeout: 30_000 });
}

test('the walkthrough shows where file and pull request findings go', async ({
  desktop,
}) => {
  const { page } = desktop;
  await openWalkthrough(page);
  const shown = (text: string) =>
    pane(page).getByText(text).filter({ visible: true });

  // The pull request's own findings come first.
  await expect(shown('Split the refactor from the fix.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(shown('Pull request')).toBeVisible();
  await expect(
    shown("This comment's lines aren't in the current diff.")
  ).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('on-pr.png') });

  await pane(page).getByRole('button', { name: /^Skip/ }).click();
  await expect(shown('The retry module has no tests.')).toBeVisible();
  await expect(pane(page).getByTitle('Open this file in the diff')).toHaveText(
    FILE
  );
  await expect(
    shown("This comment's lines aren't in the current diff.")
  ).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('on-file.png') });

  // In the diff, a finding on the whole file hangs with the file.
  await pane(page).getByTitle('Open this file in the diff').click();
  await expect(shown('The retry module has no tests.')).toBeVisible();
  // Its place is the file alone, with no line after it.
  await expect(page.locator('[data-draft="on-file"]')).toContainText(
    /majorsrc\/retry\.ts(?!:)/
  );
  await page.screenshot({ path: test.info().outputPath('in-diff.png') });
});

test('posting files a file comment and the review text', async ({
  desktop,
}) => {
  const { page, homeDir, repoPath } = desktop;
  const head = execFileSync('git', ['rev-parse', BRANCH], {
    cwd: repoPath,
    encoding: 'utf8',
  }).trim();
  updateFakeGh(homeDir, (scenario) => {
    scenario.prs[0].headRefOid = head;
  });
  expect(
    await page.evaluate(
      (headSha) =>
        window.n10.postDraftComments({ prId: 77, headSha }).then(
          (count) => ({ count }),
          (error: Error) => ({ error: error.message })
        ),
      head
    )
  ).toEqual({ count: 2 });

  const scenario = JSON.parse(
    readFileSync(fakeGhScenarioPath(homeDir), 'utf8')
  ) as FakeGitHub;
  expect(scenario.prs[0].threads).toEqual([
    {
      path: FILE,
      comments: [
        {
          author: 'bea',
          body: expect.stringContaining('The retry module has no tests.'),
        },
      ],
    },
  ]);
  expect(scenario.prs[0].reviews).toMatchObject([
    {
      commit: head,
      state: 'COMMENTED',
      body: expect.stringContaining('Split the refactor from the fix.'),
    },
  ]);
});
