import { describe, expect, it } from 'vitest';
import { BEAM } from '../data/beam.js';
import { N10 } from '../data/n10.js';
import { hunkTo } from './conversation.js';
import { createPullRequestHost } from './pull-request-host.js';
import { createReviewHost } from './review-host.js';
import { DemoState } from './state.js';

/** The demo answers the reads by identity from its own rows, the way a
 *  provider would, so the Overview has something real to show. */
describe('the demo pull request host', () => {
  const state = new DemoState();
  state.open(N10);
  const host = createPullRequestHost(state);
  const ref = (number: number) => ({
    provider: 'github',
    host: 'github.com',
    repository: 'notaharness/n10',
    number,
  });

  it('reads a demo pull request’s detail, with its head', async () => {
    const snapshot = await host.getPullRequestSnapshot({ ref: ref(177) });
    expect(snapshot.detail).toMatchObject({
      state: 'read',
      value: {
        title: "fix(desktop): keep a worktree's tab when its branch switches",
        source: { branch: 'fix/tab-branch-switch' },
      },
    });
    expect(snapshot.head).toEqual({
      oid: '905bbcb2036a4f1e8c2d7b9a5e3f6c1d8b4a2e7f',
      from: 'detail',
    });
    // The teammate's changes requested, in GitHub's words, on the head.
    expect(snapshot.detail).toMatchObject({
      value: {
        reviewers: {
          state: 'read',
          value: {
            items: [
              {
                identifier: 'demo-teammate',
                decision: 'changes-requested',
                native: 'CHANGES_REQUESTED',
                reviewedHead: '905bbcb2036a4f1e8c2d7b9a5e3f6c1d8b4a2e7f',
              },
              // Asked for its paths, by the id its rule sets use.
              {
                kind: 'team',
                identifier: 'notaharness/desktop',
                ruleId: '7301',
                requested: true,
              },
            ],
            complete: true,
          },
        },
      },
    });
  });

  it('says a number the demo does not have is not found', async () => {
    const snapshot = await host.getPullRequestSnapshot({ ref: ref(1) });
    expect(snapshot.summary).toEqual({ kind: 'gone' });
    expect(snapshot.detail).toMatchObject({
      state: 'failed',
      kind: 'not-found',
    });
  });
});

/** Checks and readiness come from core's own evaluation of a GitHub
 *  shaped read, so the demo says what n10 would of the same facts. */
describe('the demo checks read', () => {
  function open(cwd: string) {
    const state = new DemoState();
    const repo = state.open(cwd);
    const host = createPullRequestHost(state);
    const slug = repo.data.slug;
    const read = (number: number) =>
      host.getPullRequestChecks({
        ref: {
          provider: 'github',
          host: 'github.com',
          repository: slug,
          number,
        },
      });
    return { repo, read };
  }

  it('lists the jobs on the head, and says what blocks completion', async () => {
    const { read } = open(N10);
    const answer = await read(177);
    expect(answer.list?.rows.map((r) => [r.check.name, r.standing])).toEqual([
      ['main', 'blocking'],
      ['integration', 'passed'],
    ]);
    expect(answer.readiness.state).toBe('blocked');
    expect(answer.readiness.blockers.map((b) => b.text)).toEqual([
      '1 required check failing: main',
      'Changes requested',
      '2 unresolved conversations',
    ]);
  });

  it('reads an approved pull request with passing checks as ready', async () => {
    const { read } = open(N10);
    const answer = await read(171);
    expect(answer.readiness).toMatchObject({
      state: 'ready',
      blockers: [],
      unknowns: [],
    });
  });

  it('follows the row as an agent pushes a fix and resolves the threads', async () => {
    const { repo, read } = open(N10);
    repo.updatePr(177, { buildStatus: 'pending' });
    expect((await read(177)).readiness.blockers.map((b) => b.text)).toContain(
      'Waiting for 1 required check: main'
    );
    repo.resolveThreads(177);
    repo.updatePr(177, { buildStatus: 'succeeded' });
    expect((await read(177)).readiness.blockers.map((b) => b.text)).toEqual([
      'Changes requested',
    ]);
  });

  it('waits for the review the rules ask for, which is the viewer’s', async () => {
    const { read } = open(N10);
    const answer = await read(175);
    expect(answer.readiness).toMatchObject({
      state: 'blocked',
      blockers: [
        {
          kind: 'reviews',
          text: 'Waiting for your review',
          resolvedBy: 'viewer',
        },
      ],
    });
    // GitHub states the rule's count and marks no reviewer required.
    expect(answer.readiness.aspects).toContainEqual({
      id: 'reviews',
      state: 'waiting',
      text: 'Waiting for review · 1 approval required',
    });
    expect(answer.requirements).toMatchObject({
      reviewers: {
        state: 'read',
        value: {
          items: [
            {
              identifier: 'HermannBjorgvin',
              requirement: 'unknown',
              requested: true,
              rules: [],
            },
            // The rule set that names the team, with its paths: the
            // Reviewers hover.
            {
              identifier: 'notaharness/desktop',
              requirement: 'unknown',
              reason: null,
              rules: [
                {
                  name: 'Ruleset',
                  asks: '1 approval required',
                  paths: [
                    'apps/desktop/**',
                    'apps/desktop-e2e/**',
                    'libs/app-core/**',
                  ],
                  applies: null,
                },
              ],
            },
          ],
        },
      },
    });
  });

  it('holds on an unresolved thread where the rules ask for resolution', async () => {
    const { repo, read } = open(N10);
    repo.updatePr(171, { activeCommentCount: 1 });
    expect((await read(171)).readiness).toMatchObject({
      state: 'blocked',
      blockers: [{ text: '1 unresolved conversation' }],
    });
  });

  it('asks nothing of reviews where the rules ask none', async () => {
    const { read } = open(BEAM);
    const answer = await read(38);
    expect(answer.readiness.state).toBe('ready');
    expect(answer.list?.rows.map((r) => r.check.requirement)).toEqual([
      'required',
      'optional',
    ]);
    expect(answer.readiness.aspects).toContainEqual({
      id: 'reviews',
      state: 'met',
      text: 'Nothing blocking',
    });
    // GitHub states no review decision without a rule that asks one.
    expect((await read(39)).readiness).toMatchObject({
      state: 'blocked',
      blockers: [{ text: 'Waiting for 1 required check: ci' }],
      unknowns: ['The review requirement'],
    });
  });

  it('refuses a number the demo does not have', async () => {
    const { read } = open(N10);
    await expect(read(1)).rejects.toThrow('#1 is not in the demo');
  });
});

/** The conversation is the review host's own threads, as GitHub's read
 *  would describe them, so a reply or resolve shows in both places. */
describe('the demo conversation read', () => {
  const ref = {
    provider: 'github',
    host: 'github.com',
    repository: 'notaharness/n10',
    number: 177,
  };

  it('reads the review threads with their excerpts, the comment and the review', async () => {
    const state = new DemoState();
    state.open(N10);
    const { conversation } = await createPullRequestHost(
      state
    ).getPullRequestConversation({ ref });
    expect(conversation.state).toBe('read');
    if (conversation.state !== 'read') return;
    const c = conversation.value;
    expect(c.threads.map((t) => [t.anchor?.path, t.status.resolved])).toEqual([
      ['apps/desktop/src/renderer/lib/tabs/tab-sync.ts', false],
      ['apps/desktop/src/host/services/worktree-sessions.ts', false],
    ]);
    // GitHub ends the excerpt on the commented line of the real diff.
    const hunk = c.threads[0]?.anchor?.diffHunk ?? '';
    expect(hunk.startsWith('@@ ')).toBe(true);
    expect(hunkTo(hunk, 77)).toBe(hunk);
    expect(c.comments).toHaveLength(1);
    expect(c.reviews).toMatchObject([
      {
        author: { identifier: 'demo-teammate' },
        state: 'changes-requested',
        native: 'CHANGES_REQUESTED',
        commentCount: 2,
      },
    ]);
    expect(c.threads[0]?.comments[0]?.reviewId).toBe(c.reviews[0]?.id);
    expect(Object.values(c.coverage).every((part) => part.complete)).toBe(true);
  });

  it('shows a reply and a resolve made through the review host', async () => {
    const state = new DemoState();
    state.open(N10);
    const review = createReviewHost(state);
    const [first] = state.repo().threadsOf(177).threads;
    if (!first) throw new Error('no thread');
    await review.replyToThread({ prId: 177, thread: first, body: 'Fixed.' });
    await review.setThreadResolved({
      prId: 177,
      thread: first,
      resolved: true,
    });
    const { conversation } = await createPullRequestHost(
      state
    ).getPullRequestConversation({ ref });
    if (conversation.state !== 'read') throw new Error('not read');
    const [thread] = conversation.value.threads;
    expect(thread?.status).toMatchObject({
      resolved: true,
      resolvedBy: { identifier: 'HermannBjorgvin' },
    });
    expect(thread?.comments.at(-1)).toMatchObject({
      body: 'Fixed.',
      replyTo: thread?.comments[0]?.id,
      capabilities: { edit: { state: 'supported' } },
    });
  });

  it('answers a conversation comment with another, as GitHub does', async () => {
    const state = new DemoState();
    state.open(N10);
    const review = createReviewHost(state);
    const [general] = state.repo().threadsOf(177).generalComments;
    if (!general) throw new Error('no comment');
    await review.replyToThread({ prId: 177, thread: general, body: 'On it.' });
    const { conversation } = await createPullRequestHost(
      state
    ).getPullRequestConversation({ ref });
    if (conversation.state !== 'read') throw new Error('not read');
    // Each comment is known by the id the diff's read gives its thread,
    // which is what the Overview's actions look it up by.
    const held = state.repo().threadsOf(177).generalComments;
    expect(conversation.value.comments.map((c) => [c.id, c.body])).toEqual(
      held.map((t) => [t.id, t.comments[0]?.body])
    );
    expect(conversation.value.comments.at(-1)).toMatchObject({
      body: 'On it.',
      replyTo: null,
    });
  });
});

describe('hunkTo', () => {
  it('ends the hunk on the new-side line, skipping removed lines', () => {
    const section = [
      'diff --git a/f b/f',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+deux',
      ' three',
    ].join('\n');
    expect(hunkTo(section, 2)).toBe('@@ -1,3 +1,3 @@\n one\n-two\n+deux');
    expect(hunkTo(section, 9)).toBeNull();
  });
});
