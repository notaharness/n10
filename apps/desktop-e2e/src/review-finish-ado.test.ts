import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import {
  fakeAdoServed,
  placeAdoPr,
  updateFakeAdo,
  type FakeAzureDevOps,
} from './setup/fake-ado.js';
import { openFinishForm, showComments } from './setup/finish-form.js';
import { git } from './setup/pr-diff.js';

/**
 * Finishing a review on Azure DevOps: its votes, not GitHub's verdicts,
 * and the review filed as Azure files one — each comment a thread, the
 * summary a thread of its own, then the vote.
 */

const BRANCH = 'retry-budget';
const FILE = 'src/retry.ts';
const PR = 77;

const AZURE: FakeAzureDevOps = {
  user: { displayName: 'Bea Lin', uniqueName: 'bea@example.com' },
  prs: [
    {
      id: PR,
      title: 'Cap retries per request',
      sourceBranch: BRANCH,
      author: 'Alex Kim',
    },
  ],
};

test.use({
  fakeAzureDevOps: AZURE,
  // The list re-reads Azure every second, so the commits placed below
  // reach the app inside the test.
  n10Config: { prPollInterval: 1_000 },
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

async function openDiff({
  page,
  homeDir,
  repoPath,
}: {
  page: Page;
  homeDir: string;
  repoPath: string;
}) {
  placeAdoPr(homeDir, PR, {
    head: git(repoPath, 'rev-parse', BRANCH),
    target: git(repoPath, 'rev-parse', 'main'),
    paths: [FILE],
  });
  await sidebarRow(page, /Cap retries per request|#77/)
    .first()
    .click({ timeout: 30_000 });
  await page
    .getByRole('button', { name: 'Review changes' })
    .click({ timeout: 30_000 });
  await expect(gutterOf(page, 'RIGHT', 1)).toBeVisible({ timeout: 30_000 });
}

test.describe('Finishing a review on Azure DevOps', () => {
  test('offers its votes, and files the comments as threads before the vote', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await openDiff(desktop);
    await gutterOf(page, 'RIGHT', 1).click();
    await page.getByRole('button', { name: 'Comment on new line 1' }).click();
    await page.getByRole('textbox', { name: 'Comment' }).fill('Why three?');
    await page.getByRole('button', { name: 'Add to review' }).click();

    const form = await openFinishForm(page);
    // Azure's votes, in its order; GitHub's Request changes is not one.
    await expect(form.getByRole('radio')).toHaveCount(5);
    for (const name of [
      'Comment',
      'Approve',
      'Approve with suggestions',
      'Wait for author',
      'Reject',
    ]) {
      await expect(
        form.getByRole('radio', { name, exact: true })
      ).toBeEnabled();
    }

    await form.getByRole('radio', { name: 'Approve with suggestions' }).click();
    await form
      .getByRole('textbox', { name: 'Summary' })
      .fill('Fine, but see the note.');
    await form
      .getByRole('button', { name: 'Approve with suggestions' })
      .click();
    await expect(form.getByRole('status')).toHaveText(
      'Review filed on Azure DevOps with 1 comment.'
    );

    expect(fakeAdoServed(homeDir)).toMatchObject({
      writes: [
        {
          kind: 'thread',
          thread: {
            comments: [{ content: 'Why three?' }],
            threadContext: { filePath: `/${FILE}` },
          },
        },
        {
          kind: 'thread',
          thread: { comments: [{ content: 'Fine, but see the note.' }] },
        },
        { kind: 'vote', prId: PR, vote: 5 },
      ],
    });
  });
});

test.describe('When Azure DevOps does not take it', () => {
  async function draftAndOpenForm(page: Page) {
    await gutterOf(page, 'RIGHT', 1).click();
    await page.getByRole('button', { name: 'Comment on new line 1' }).click();
    await page.getByRole('textbox', { name: 'Comment' }).fill('Why three?');
    await page.getByRole('button', { name: 'Add to review' }).click();
    return openFinishForm(page);
  }
  const threads = (homeDir: string, text: string) =>
    (fakeAdoServed(homeDir).writes ?? []).filter(
      (w) => w.kind === 'thread' && JSON.stringify(w.thread).includes(text)
    ).length;

  test('refuses a head it has moved past, and posts nothing', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await openDiff(desktop);
    const form = await draftAndOpenForm(page);
    updateFakeAdo(homeDir, (s) => {
      s.prs[0]!.lastMergeSourceCommit = { commitId: 'e'.repeat(40) };
    });
    await form.getByRole('button', { name: 'Submit comment' }).click();
    await expect(form.getByRole('alert')).toContainText(
      'Azure DevOps did not file the review: The pull request has new commits since'
    );
    expect(fakeAdoServed(homeDir).writes ?? []).toEqual([]);
    await showComments(form);
    await expect(
      form.getByRole('checkbox', { name: `${FILE}:1` })
    ).toBeEnabled();
  });

  test('says a comment may be posted when no answer came, and posts it once', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await openDiff(desktop);
    updateFakeAdo(homeDir, (s) => {
      s.loseWrites = ['thread'];
    });
    const form = await draftAndOpenForm(page);
    await form.getByRole('button', { name: 'Submit comment' }).click();
    await expect(form.getByRole('alert')).toContainText(
      'Some of it may already be posted; submitting again looks for it first and posts nothing twice.'
    );
    expect(threads(homeDir, 'Why three?')).toBe(1);

    await form.getByRole('button', { name: 'Submit comment' }).click();
    await expect(form.getByRole('status')).toContainText('Azure DevOps');
    await expect(form.getByRole('status')).toContainText('1 comment');
    expect(threads(homeDir, 'Why three?')).toBe(1);
    // A comment casts no vote: the one thread is all that was written.
    expect(fakeAdoServed(homeDir).writes).toHaveLength(1);
  });
});
