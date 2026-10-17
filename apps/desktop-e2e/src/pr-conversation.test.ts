import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { q2Conversation, Q2_COUNTS } from './fixtures/conversation-q2.js';
import { updateFakeGh, type FakeGitHub } from './setup/fake-gh.js';

/**
 * The conversation read through the real host, against a fake `gh`
 * that pages like GitHub (C1, Q2). There is no conversation UI yet, so
 * this drives the bridge the Overview will read from and asserts that
 * nothing past a first page of a hundred goes missing.
 */

const BRANCH = 'feature-talk';

const GITHUB: FakeGitHub = {
  prs: [
    {
      number: 42,
      title: 'A long conversation',
      headRefName: BRANCH,
      ...q2Conversation(),
    },
  ],
};

test.use({ fakeGitHub: GITHUB, repo: { worktrees: [{ branch: BRANCH }] } });

async function readConversation(page: Page, number: number) {
  return page.evaluate(async (n) => {
    const repo = await window.n10.getRepo();
    if (!repo?.repository) throw new Error('no provider for the open repo');
    return window.n10.getPullRequestConversation(repo.cwd, {
      ref: { ...repo.repository, number: n },
    });
  }, number);
}

/** The conversation a read produced; throws on any other outcome. */
function conversationOf(read: Awaited<ReturnType<typeof readConversation>>) {
  const outcome = read.conversation;
  if (outcome.state === 'read') return outcome.value;
  throw new Error(`conversation not read: ${JSON.stringify(outcome)}`);
}

test.describe('Pull request conversation', () => {
  test('reads every thread, reply, comment and review past the first page', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await expect
      .poll(() => page.evaluate(() => window.n10.getRepo()), {
        timeout: 30_000,
      })
      .toMatchObject({ repository: { repository: 'n10/fixture' } });

    const read = await readConversation(page, 42);
    expect(read.ref.number).toBe(42);
    const c = conversationOf(read);
    expect(c.threads).toHaveLength(Q2_COUNTS.threads);
    expect(c.threads[6]!.comments).toHaveLength(
      Q2_COUNTS.longThreadReplies + 1
    );
    expect(c.comments).toHaveLength(Q2_COUNTS.comments);
    expect(c.reviews).toHaveLength(Q2_COUNTS.reviews);
    expect(c.events.map((e) => e.kind)).toEqual([
      'commit',
      'force-push',
      'review-requested',
    ]);
    expect(Object.values(c.coverage).every((part) => part.complete)).toBe(true);

    // The summary review with no inline comments keeps its verdict and
    // text; the resolved thread names who resolved it.
    expect(c.reviews[2]).toMatchObject({
      state: 'approved',
      body: 'Summary only: looks right.',
      commentCount: 0,
    });
    expect(c.threads[0]!.status).toMatchObject({
      resolved: true,
      resolvedBy: { identifier: 'alex' },
    });
    // An outdated left-side thread keeps its original range; a thread on
    // a file with no lines is a file thread.
    expect(c.threads[1]).toMatchObject({
      isOutdated: true,
      anchor: { current: null, original: { side: 'LEFT', end: 3 } },
    });
    expect(c.threads[2]).toMatchObject({ scope: 'file' });
    expect(c.comments[0]!.author).toMatchObject({ kind: 'bot' });
  });

  test('reports a failed read as failed, not as an empty conversation', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await expect
      .poll(() => page.evaluate(() => window.n10.getRepo()), {
        timeout: 30_000,
      })
      .toMatchObject({ repository: { repository: 'n10/fixture' } });
    updateFakeGh(homeDir, (s) => {
      s.prs[0]!.failing = { conversation: true };
    });

    const read = await readConversation(page, 42);
    expect(read.conversation).toMatchObject({
      state: 'failed',
      kind: 'server',
    });
  });
});
