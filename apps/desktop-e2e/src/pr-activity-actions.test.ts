import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  REVIEW_FILES,
  reviewConversation,
} from './fixtures/conversation-review.js';
import { sidebarRow } from './setup/app.js';
import {
  fakeGhScenarioPath,
  type FakeGitHub,
  type FakeThread,
} from './setup/fake-gh.js';

/**
 * The Overview's activity cards act as the diff's thread cards do:
 * queue a thread in the plan, reply, and resolve or reopen it, through
 * the same host calls. Each is offered only where GitHub lets the
 * viewer take it: a conversation comment is answered with another and
 * never resolved, and a locked thread takes no reply.
 */

const BRANCH = 'cancel-requests';

const LOCKED: FakeThread = {
  id: 'T-locked',
  path: 'src/request.ts',
  line: 2,
  canReply: false,
  canResolve: false,
  comments: [
    {
      author: 'dan',
      body: 'question (non-blocking): Locked: see the design doc.',
      createdAt: '2026-09-20T12:30:00Z',
    },
  ],
};

const conversation = reviewConversation();

const GITHUB: FakeGitHub = {
  username: 'bea',
  prs: [
    {
      number: 214,
      title: 'Handle cancelled requests',
      headRefName: BRANCH,
      author: 'alex',
      body: 'Cancelled requests leak their timer.',
      checks: [{ name: 'build', state: 'SUCCESS', required: true }],
      ...conversation,
      threads: [...(conversation.threads ?? []), LOCKED],
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: { worktrees: [{ branch: BRANCH, files: REVIEW_FILES }] },
});

async function openActivity(page: Page) {
  await sidebarRow(page, /Handle cancelled requests|#214/)
    .first()
    .click();
  const activity = page.getByRole('region', { name: /Activity/ });
  await expect(activity.getByRole('list').first()).toBeVisible({
    timeout: 30_000,
  });
  return activity;
}

/** A thread as the fake now holds it, after the app's writes. */
function heldThread(homeDir: string, id: string) {
  const scenario = JSON.parse(
    readFileSync(fakeGhScenarioPath(homeDir), 'utf8')
  ) as FakeGitHub;
  return scenario.prs[0]?.threads?.find((t) => t.id === id);
}

test.describe('Acting on the activity', () => {
  test('replies to a review thread and resolves it', async ({ desktop }) => {
    const { page, homeDir } = desktop;
    const activity = await openActivity(page);
    const card = activity.locator('[data-thread-id="T-open"]');

    await card.getByRole('button', { name: 'Reply…', exact: true }).click();
    await card.getByPlaceholder(/Write a reply/).fill('Covered by a test now.');
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    // The reply lands in the thread, read back from GitHub, and the box
    // closes.
    await expect(
      card.locator('[data-comment-id]', { hasText: 'Covered by a test now.' })
    ).toBeVisible();
    await expect(card.getByPlaceholder(/Write a reply/)).toHaveCount(0);
    expect(heldThread(homeDir, 'T-open')?.comments.at(-1)?.body).toBe(
      'Covered by a test now.'
    );

    await card.getByRole('button', { name: 'Resolve' }).click();
    // Resolved while in view: it stays, with its new status.
    await expect(card.getByRole('button', { name: 'Reopen' })).toBeVisible();
    await expect(card).toContainText('Resolved');
    await expect
      .poll(() => heldThread(homeDir, 'T-open')?.isResolved)
      .toBe(true);
  });

  test('queues a thread in the plan from its header', async ({ desktop }) => {
    const activity = await openActivity(desktop.page);
    const card = activity.locator('[data-thread-id="T-file"]');
    await card.hover();
    await card
      .getByRole('button', { name: 'Add to plan', exact: true })
      .click();
    await expect(
      card.getByRole('button', { name: 'Remove from plan' })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('answers a conversation comment with another, and never resolves it', async ({
    desktop,
  }) => {
    const activity = await openActivity(desktop.page);
    const card = activity.locator('article', {
      has: desktop.page.locator('[data-comment-id="general-1"]'),
    });
    // Its actions have arrived once Reply is offered.
    const reply = card.getByRole('button', { name: 'Reply…', exact: true });
    await expect(reply).toBeVisible();
    await expect(card.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
    await reply.click();
    await card.getByPlaceholder(/Write a reply/).fill('Thanks for the fix.');
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    // A new comment beside it, not nested: it is the viewer's own, so
    // it shows at once.
    const answer = activity.locator('article', {
      has: desktop.page.locator('[data-comment-id]', {
        hasText: 'Thanks for the fix.',
      }),
    });
    await expect(answer).toHaveCount(1);
    await expect(card).not.toContainText('Thanks for the fix.');
  });

  test('offers no reply or resolve where GitHub allows neither', async ({
    desktop,
  }) => {
    const activity = await openActivity(desktop.page);
    const card = activity.locator('[data-thread-id="T-locked"]');
    await expect(card).toContainText('Locked: see the design doc.');
    // The labels sit on the header row, after the author and the time,
    // and out of the body.
    const comment = card.locator('[data-comment-id]');
    const header = comment.locator('> div').first();
    await expect(header).toContainText('dan');
    await expect(header.locator('[data-comment-labels]')).toHaveText(
      /question\s*non-blocking/
    );
    await expect(comment.locator('> div').nth(1)).not.toContainText('question');
    // Queueing it for the agent is n10's own, and stays; once it shows,
    // the card's actions have arrived.
    await card.hover();
    await expect(
      card.getByRole('button', { name: 'Add to plan', exact: true })
    ).toBeVisible();
    await expect(card.getByRole('button', { name: /^Reply/ })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
  });
});
