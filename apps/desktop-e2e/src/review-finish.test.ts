import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures/desktop.js';
import { resizeWindow, sidebarRow } from './setup/app.js';
import {
  fakeGhScenarioPath,
  updateFakeGh,
  type FakeGitHub,
} from './setup/fake-gh.js';
import {
  commentsToggle,
  openFinishForm,
  showComments,
} from './setup/finish-form.js';
import { commitOnBranch, git } from './setup/pr-diff.js';

/**
 * Finishing a review on GitHub: from the diff that Review changes
 * opens, a form takes the summary, GitHub's verdicts and the comments
 * to file, and files them as one review on the commit read. What came
 * of it is said as the drafts file records it.
 */

const BRANCH = 'retry-budget';
const FILE = 'src/retry.ts';

test.use({
  fakeGitHub: {
    username: 'bea',
    prs: [
      {
        number: 321,
        title: 'Cap retries per request',
        headRefName: BRANCH,
        author: 'alex',
      },
    ],
  },
  repo: {
    baseFiles: {
      [FILE]: 'export const RETRIES = 5;\nexport const WAIT = 100;\n',
    },
    worktrees: [
      {
        branch: BRANCH,
        files: {
          [FILE]: 'export const RETRIES = 3;\nexport const WAIT = 250;\n',
          'notes.txt': 'first version\n',
        },
      },
    ],
  },
});

function scenario(homeDir: string): FakeGitHub {
  return JSON.parse(
    readFileSync(fakeGhScenarioPath(homeDir), 'utf8')
  ) as FakeGitHub;
}

/** GitHub reports the branch's tip as the pull request's head. */
function pushed(homeDir: string, head: string) {
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.headRefOid = head;
  });
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
  pushed(homeDir, git(repoPath, 'rev-parse', BRANCH));
  await sidebarRow(page, /Cap retries per request|#321/)
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Review changes' })
    .click({ timeout: 30_000 });
  await expect(gutterOf(page, 'RIGHT', 1)).toBeVisible();
}

function gutterOf(page: Page, side: 'LEFT' | 'RIGHT', line: number) {
  return page.locator(`[data-file="${FILE}"][data-point="${side}:${line}"]`);
}

async function draftOn(
  page: Page,
  side: 'LEFT' | 'RIGHT',
  line: number,
  text: string
) {
  await gutterOf(page, side, line).click();
  const where = `${side === 'LEFT' ? 'old' : 'new'} line ${line}`;
  await page.getByRole('button', { name: `Comment on ${where}` }).click();
  await page.getByRole('textbox', { name: 'Comment' }).fill(text);
  await page.getByRole('button', { name: 'Add to review' }).click();
  await expect(
    page.locator('[data-my-draft]', { hasText: text })
  ).toBeVisible();
}

test.describe('Review changes and Finish review', () => {
  test('share one spot: a second click where the first was opens the form', async ({
    desktop,
  }) => {
    const { app, page, homeDir, repoPath } = desktop;
    pushed(homeDir, git(repoPath, 'rev-parse', BRANCH));
    await sidebarRow(page, /Cap retries per request|#321/)
      .first()
      .click();
    const review = page.getByRole('button', { name: 'Review changes' });
    const finish = page.getByRole('button', { name: 'Finish review' });
    const form = page.getByRole('dialog', { name: 'Finish your review' });
    // A narrow pane, one that just fits the Overview's column, and wide
    // ones that centre it.
    for (const width of [1024, 1440, 1920, 2560]) {
      await resizeWindow(app, width, 900);
      await expect(review).toBeVisible({ timeout: 30_000 });
      const first = (await review.boundingBox())!;
      const x = first.x + first.width / 2;
      const y = first.y + first.height / 2;
      await page.mouse.click(x, y);
      await expect(finish).toBeVisible();
      const second = (await finish.boundingBox())!;
      expect(second.y, `top at ${width} px`).toBeCloseTo(first.y, 0);
      expect(second.height, `height at ${width} px`).toBeCloseTo(
        first.height,
        0
      );
      expect(second.x + second.width, `end at ${width} px`).toBeCloseTo(
        first.x + first.width,
        0
      );
      await page.mouse.click(x, y);
      await expect(form).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(form).toBeHidden();
      await page.getByRole('button', { name: 'Back to review' }).click();
    }
  });
});

test.describe('Finishing a review on GitHub', () => {
  test('files the summary, the verdict and the chosen comments as one review', async ({
    desktop,
  }) => {
    const { page, homeDir, repoPath } = desktop;
    const head = git(repoPath, 'rev-parse', BRANCH);
    await openDiff(desktop);
    await draftOn(page, 'RIGHT', 1, 'Why three?');
    await draftOn(page, 'LEFT', 2, 'The old wait was fine.');

    const form = await openFinishForm(page);
    await expect(form.getByRole('radio')).toHaveCount(3);
    for (const name of ['Comment', 'Approve', 'Request changes']) {
      await expect(form.getByRole('radio', { name })).toBeEnabled();
    }
    // Every comment goes, until the reviewer says otherwise.
    await expect(commentsToggle(form)).toHaveText('2 comments');
    await showComments(form);
    const first = form.getByRole('checkbox', { name: `${FILE}:1` });
    const second = form.getByRole('checkbox', { name: `${FILE}:2` });
    await expect(first).toBeChecked();
    await expect(second).toBeChecked();
    await second.click();
    await expect(commentsToggle(form)).toHaveText('1 of 2 comments');

    await form.getByRole('radio', { name: 'Request changes' }).click();
    await form
      .getByRole('textbox', { name: 'Summary' })
      .fill('Three retries is too few.');
    await form.getByRole('button', { name: 'Request changes' }).click();
    await expect(form.getByRole('status')).toHaveText(
      'Review filed on GitHub with 1 comment.'
    );
    await expect(
      form.getByRole('button', { name: 'Request changes' })
    ).toHaveCount(0);

    const pr = scenario(homeDir).prs[0]!;
    expect(pr.reviews).toMatchObject([
      {
        commit: head,
        state: 'CHANGES_REQUESTED',
        body: 'Three retries is too few.',
        commentCount: 1,
      },
    ]);
    expect(pr.threads?.map((t) => t.comments[0]!.body)).toEqual(['Why three?']);

    // The comment left out is still the reviewer's draft.
    await form.getByRole('button', { name: 'Done' }).click();
    await expect(
      page.locator('[data-my-draft]', { hasText: 'The old wait was fine.' })
    ).toBeVisible();
    // The summary went with the review: the next starts empty.
    await openFinishForm(page);
    await expect(form.getByRole('textbox', { name: 'Summary' })).toHaveValue(
      ''
    );
  });

  test('asks for words before requesting changes or commenting', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openDiff(desktop);
    const form = await openFinishForm(page);
    // No comments: nothing about them.
    await expect(commentsToggle(form)).toHaveCount(0);
    // The button says the verdict it files.
    const comment = form.getByRole('button', { name: 'Submit comment' });
    await expect(comment).toBeDisabled();
    await expect(comment).toHaveAccessibleDescription(
      'Write a summary or choose a comment to post.'
    );
    await form.getByRole('radio', { name: 'Request changes' }).click();
    const request = form.getByRole('button', { name: 'Request changes' });
    await expect(request).toBeDisabled();
    await expect(request).toHaveAccessibleDescription(
      'Say what needs to change: write a summary or choose a comment.'
    );
    // Approving needs nothing said.
    await form.getByRole('radio', { name: 'Approve' }).click();
    await expect(
      form.getByRole('button', { name: 'Approve', exact: true })
    ).toBeEnabled();
  });

  test('says a review may be posted when GitHub did not answer, and finds it on retry', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    updateFakeGh(homeDir, (s) => {
      s.loseAnswers = ['SubmitReview'];
    });
    await openDiff(desktop);
    await draftOn(page, 'RIGHT', 1, 'Why three?');
    const form = await openFinishForm(page);
    await form.getByRole('button', { name: 'Submit comment' }).click();
    await expect(form.getByRole('alert')).toContainText(
      'Some of it may already be posted; submitting again looks for it first and posts nothing twice.'
    );
    await showComments(form);
    await expect(
      form.getByRole('checkbox', { name: `${FILE}:1` })
    ).toBeDisabled();
    await expect(
      form.getByText('May already be posted: it is looked for first.')
    ).toBeVisible();

    await form.getByRole('button', { name: 'Submit comment' }).click();
    await expect(form.getByRole('status')).toHaveText(
      'This review was already filed on GitHub (commented); nothing new was sent. It holds 1 comment.'
    );
    expect(scenario(homeDir).reviewWrites?.SubmitReview).toBe(1);
  });

  test('says GitHub refused a review on a head it has moved past', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await openDiff(desktop);
    await draftOn(page, 'RIGHT', 1, 'Why three?');
    updateFakeGh(homeDir, (s) => {
      s.prs[0]!.headRefOid = 'e'.repeat(40);
    });
    const form = await openFinishForm(page);
    await form.getByRole('button', { name: 'Submit comment' }).click();
    await expect(form.getByRole('alert')).toContainText(
      'GitHub did not file the review:'
    );
    expect(scenario(homeDir).reviewWrites).toBeUndefined();
    await showComments(form);
    await expect(
      form.getByRole('checkbox', { name: `${FILE}:1` })
    ).toBeEnabled();
  });

  test.describe('after a push', () => {
    // The list re-reads GitHub every second, so a push is noticed inside
    // the test rather than after a minute.
    test.use({ n10Config: { prPollInterval: 1_000 } });

    test('approves only the commit the reviewer read, and says why not', async ({
      desktop,
    }) => {
      const { page, homeDir, repoPath } = desktop;
      await openDiff(desktop);
      const second = commitOnBranch(repoPath, BRANCH, 'second version\n');
      pushed(homeDir, second);
      await expect(
        page.getByRole('status', { name: 'New commits' })
      ).toBeVisible({ timeout: 30_000 });

      let form = await openFinishForm(page);
      const approve = form.getByRole('radio', { name: 'Approve' });
      await expect(approve).toBeDisabled();
      await expect(approve).toHaveAccessibleDescription(
        'New commits were pushed since you opened this. Load them to approve.'
      );
      await expect(form.getByRole('radio', { name: 'Comment' })).toBeEnabled();
      await page.keyboard.press('Escape');

      await page
        .getByRole('status', { name: 'New commits' })
        .getByRole('button', { name: 'Load new commits' })
        .click();
      form = await openFinishForm(page);
      await form.getByRole('radio', { name: 'Approve' }).click();
      await form.getByRole('button', { name: 'Approve' }).click();
      await expect(form.getByRole('status')).toHaveText(
        'Review filed on GitHub.'
      );
      expect(scenario(homeDir).prs[0]!.reviews).toMatchObject([
        { commit: second, state: 'APPROVED' },
      ]);
    });
  });
});
