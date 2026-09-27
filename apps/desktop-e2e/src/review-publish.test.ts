import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import {
  fakeGhScenarioPath,
  updateFakeGh,
  type FakeGitHub,
} from './setup/fake-gh.js';

/**
 * Filing the reviewer's drafts as one GitHub review (C6, F3): one
 * pending review on the commit read, its comments, one submit. An
 * answer lost on the way is looked for, never re-sent. The Finish
 * review form is I20's; these drive the bridge the form will call.
 */

const BRANCH = 'retry-budget';
const FILE = 'src/retry.ts';
const HEAD = 'f'.repeat(40);

const GITHUB: FakeGitHub = {
  username: 'bea',
  prs: [
    {
      number: 321,
      title: 'Cap retries per request',
      headRefName: BRANCH,
      author: 'alex',
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: {
    baseFiles: {
      [FILE]: 'export const RETRIES = 5;\nexport const WAIT = 100;\n',
    },
    worktrees: [
      {
        branch: BRANCH,
        files: {
          [FILE]: 'export const RETRIES = 3;\nexport const WAIT = 250;\n',
        },
      },
    ],
  },
});

function gutterOf(page: Page, side: 'LEFT' | 'RIGHT', line: number) {
  return page.locator(`[data-file="${FILE}"][data-point="${side}:${line}"]`);
}

async function draftOn(
  page: Page,
  side: 'LEFT' | 'RIGHT',
  line: number,
  text: string,
  end = line
) {
  await gutterOf(page, side, line).click();
  if (end !== line) {
    await gutterOf(page, side, end).click({ modifiers: ['Shift'] });
  }
  const lines = end === line ? `line ${line}` : `lines ${line}–${end}`;
  const where = `${side === 'LEFT' ? 'old' : 'new'} ${lines}`;
  await page.getByRole('button', { name: `Comment on ${where}` }).click();
  await page.getByRole('textbox', { name: 'Comment' }).fill(text);
  await page.getByRole('button', { name: 'Add to review' }).click();
  await expect(
    page.locator('[data-my-draft]', { hasText: text })
  ).toBeVisible();
}

async function openDiff(page: Page) {
  await sidebarRow(page, /Cap retries per request|#321/)
    .first()
    .click();
  await expect(gutterOf(page, 'RIGHT', 1)).toBeVisible({ timeout: 30_000 });
}

/** The bridge call the Finish review form makes, with every draft. */
function submit(page: Page, head = HEAD) {
  return page.evaluate(async (head) => {
    const repo = (await window.n10.getRepo())!;
    const ref = { ...repo.repository!, number: 321 };
    const { drafts } = await window.n10.listReviewDrafts({
      ref,
      viewer: repo.viewer,
    });
    return window.n10
      .submitReview({
        ref,
        viewer: repo.viewer,
        head,
        event: 'COMMENT',
        draftIds: drafts.map((d) => d.id),
      })
      .then(
        (r) => ({ ok: r.drafts.map((d) => d.publication.state) }),
        (e: Error) => ({ error: e.message })
      );
  }, head);
}

function scenario(homeDir: string): FakeGitHub {
  return JSON.parse(
    readFileSync(fakeGhScenarioPath(homeDir), 'utf8')
  ) as FakeGitHub;
}

test.describe('Publishing a review', () => {
  test('files every draft as one review on the commit read', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await openDiff(page);
    await draftOn(page, 'RIGHT', 1, 'Why three?', 2);
    await draftOn(page, 'LEFT', 2, 'The old wait was fine.');

    expect(await submit(page)).toEqual({ ok: ['published', 'published'] });
    const after = scenario(homeDir);
    expect(after.reviewWrites).toEqual({
      StartReview: 1,
      AddReviewThread: 2,
      SubmitReview: 1,
    });
    const pr = after.prs[0]!;
    expect(pr.reviews).toMatchObject([{ commit: HEAD, state: 'COMMENTED' }]);
    expect(
      pr.threads?.map((t) => [
        t.startSide,
        t.startLine,
        t.side,
        t.line,
        t.comments[0]!.body,
      ])
    ).toEqual([
      ['RIGHT', 1, 'RIGHT', 2, 'Why three?'],
      [undefined, undefined, 'LEFT', 2, 'The old wait was fine.'],
    ]);
  });

  test('a lost answer is looked for, not sent again, and the draft says so meanwhile', async ({
    desktop,
  }, testInfo) => {
    const { page, homeDir } = desktop;
    updateFakeGh(homeDir, (s) => {
      s.loseAnswers = ['SubmitReview'];
    });
    await openDiff(page);
    await draftOn(page, 'RIGHT', 1, 'Why three?');

    expect(await submit(page)).toEqual({
      error: expect.stringContaining('GitHub did not answer'),
    });
    await page.reload();
    await openDiff(page);
    await expect(
      page.getByText(
        'This may already have been posted. n10 will check before sending it again.'
      )
    ).toBeVisible();
    await expect(
      page
        .locator('[data-my-draft]')
        .getByRole('button', { name: 'Edit draft' })
    ).toHaveCount(0);
    await page
      .locator('[data-my-draft]')
      .screenshot({ path: testInfo.outputPath('unknown.png') });

    expect(await submit(page)).toEqual({ ok: ['published'] });
    const after = scenario(homeDir);
    expect(after.reviewWrites?.['SubmitReview']).toBe(1);
    expect(after.prs[0]!.reviews).toHaveLength(1);
  });

  test('a comment whose answer was lost is found in the pending review, not added again', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    updateFakeGh(homeDir, (s) => {
      s.loseAnswers = ['AddReviewThread'];
    });
    await openDiff(page);
    await draftOn(page, 'RIGHT', 1, 'Why three?');

    expect(await submit(page)).toEqual({
      error: expect.stringContaining('GitHub did not answer'),
    });
    expect(await submit(page)).toEqual({ ok: ['published'] });
    const after = scenario(homeDir);
    expect(after.reviewWrites).toEqual({
      StartReview: 1,
      AddReviewThread: 1,
      SubmitReview: 1,
    });
    expect(after.prs[0]!.threads).toHaveLength(1);
  });

  test('a pull request that moved on is not reviewed, and the drafts stay', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await openDiff(page);
    await draftOn(page, 'RIGHT', 1, 'Why three?');
    updateFakeGh(homeDir, (s) => {
      s.prs[0]!.headRefOid = 'e'.repeat(40);
    });
    expect(await submit(page)).toEqual({
      error: expect.stringContaining('new commits'),
    });
    expect(scenario(homeDir).reviewWrites).toBeUndefined();
    await page.reload();
    await openDiff(page);
    await expect(
      page
        .locator('[data-my-draft]')
        .getByRole('button', { name: 'Edit draft' })
    ).toBeVisible();
  });
});
