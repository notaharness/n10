import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/desktop.js';
import {
  fakeGhScenarioPath,
  updateFakeGh,
  type FakeGitHub,
} from './setup/fake-gh.js';

const BRANCH = 'agent-finding';
const FILE = 'src/retry.ts';
test.use({
  fakeGitHub: {
    username: 'bea',
    prs: [
      {
        number: 321,
        title: 'Review findings',
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
    321: [
      {
        id: 'finding',
        file: FILE,
        lineStart: 1,
        lineEnd: 2,
        side: 'LEFT',
        severity: 'major',
        body: 'Check the retry limit.',
        status: 'draft',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'second',
        file: FILE,
        lineStart: 1,
        lineEnd: 2,
        side: 'LEFT',
        severity: 'major',
        body: 'Keep the last confirmed result.',
        status: 'draft',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  },
});

function prepare(repoPath: string, homeDir: string) {
  const head = execFileSync('git', ['rev-parse', BRANCH], {
    cwd: repoPath,
    encoding: 'utf8',
  }).trim();
  updateFakeGh(homeDir, (scenario) => {
    scenario.prs[0].headRefOid = head;
  });
  return head;
}
function post(page: Page, head: string) {
  return page.evaluate(
    (headSha) =>
      window.n10
        .postDraftComments({ prId: 321, ids: ['finding', 'second'], headSha })
        .then(
          (count) => ({ count }),
          (error: Error) => ({ error: error.message })
        ),
    head
  );
}
async function expectPublished(page: Page, homeDir: string, head: string) {
  const findings = await page.evaluate(() => window.n10.listDraftComments(321));
  expect(findings.map((finding) => finding.status)).toEqual([
    'posted',
    'posted',
  ]);
  const scenario = JSON.parse(
    readFileSync(fakeGhScenarioPath(homeDir), 'utf8')
  ) as FakeGitHub;
  expect(scenario.reviewWrites).toEqual({
    StartReview: 1,
    AddReviewThread: 2,
    SubmitReview: 1,
  });
  expect(scenario.prs[0].reviews).toMatchObject([
    { commit: head, state: 'COMMENTED' },
  ]);
  expect(scenario.prs[0].threads).toMatchObject([
    {
      startSide: 'LEFT',
      startLine: 1,
      side: 'LEFT',
      line: 2,
      comments: [{ body: expect.stringContaining('Check the retry limit.') }],
    },
    {
      comments: [
        { body: expect.stringContaining('Keep the last confirmed result.') },
      ],
    },
  ]);
}

test('agent findings use the native review publisher', async ({ desktop }) => {
  const { page, homeDir, repoPath } = desktop;
  const head = prepare(repoPath, homeDir);
  expect(await post(page, head)).toEqual({ count: 2 });
  await expectPublished(page, homeDir, head);
});

test('agent findings reconcile a lost answer without another write', async ({
  desktop,
}) => {
  const { page, homeDir, repoPath } = desktop;
  const head = prepare(repoPath, homeDir);
  updateFakeGh(homeDir, (scenario) => {
    scenario.loseAnswers = ['SubmitReview'];
  });
  expect(await post(page, head)).toHaveProperty('error');
  expect(
    await page.evaluate(() =>
      window.n10.updateDraftComment(321, 'finding', { body: 'different' }).then(
        () => 'saved',
        (error: Error) => error.message
      )
    )
  ).toContain('may already be posted');
  expect(await post(page, head)).toEqual({ count: 2 });
  await expectPublished(page, homeDir, head);
});
