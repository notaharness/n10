import { describe, expect, it } from 'vitest';
import {
  isConversationComplete,
  throttledError,
  type PullRequestRef,
} from '@n10/vcs-core';
import {
  CONNECTION_PAGE_QUERIES,
  CONVERSATION_QUERY,
  THREAD_REPLIES_QUERY,
} from './pr-conversation-queries.js';
import {
  fetchGitHubConversation,
  PAGE_LIMIT,
  type GraphQl,
} from './pr-conversation.js';

// ── A GitHub that pages ────────────────────────────────────────────
//
// The Q2 conversation fixture: 130 review threads, one of them with
// 125 replies, 150 conversation comments and three submitted reviews.
// The fake answers the reader's queries a hundred nodes per page with
// offset cursors, the way GitHub caps its connections, so a reader
// that stops at the first page is caught by the counts.

const REF: PullRequestRef = {
  provider: 'github',
  host: 'github.com',
  repository: 'n10/fixture',
  number: 42,
};

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);

const user = (login: string) => ({ __typename: 'User', login });

function reviewComment(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    author: user('bea'),
    body: `comment ${id}`,
    createdAt: '2026-09-01T10:00:00Z',
    lastEditedAt: null,
    isMinimized: false,
    minimizedReason: null,
    url: `https://github.com/n10/fixture/pull/42#${id}`,
    replyTo: null,
    pullRequestReview: { id: 'review-1' },
    viewerCanUpdate: false,
    viewerCannotUpdateReasons: ['INSUFFICIENT_ACCESS'],
    viewerCanDelete: false,
    state: 'SUBMITTED',
    diffHunk: '@@ -38,4 +38,6 @@ function run() {',
    originalCommit: { oid: OID_A },
    ...extra,
  };
}

interface FakeThread {
  node: Record<string, unknown>;
  comments: Record<string, unknown>[];
}

function thread(i: number, extra: Record<string, unknown> = {}): FakeThread {
  const id = `thread-${i}`;
  return {
    node: {
      id,
      isResolved: false,
      isOutdated: false,
      path: 'src/request.ts',
      subjectType: 'LINE',
      line: 41,
      startLine: null,
      originalLine: 41,
      originalStartLine: null,
      diffSide: 'RIGHT',
      startDiffSide: null,
      resolvedBy: null,
      viewerCanReply: true,
      viewerCanResolve: true,
      viewerCanUnresolve: false,
      ...extra,
    },
    comments: [reviewComment(`${id}-c1`)],
  };
}

function issueComment(i: number) {
  return {
    id: `general-${i}`,
    author: user(i % 2 ? 'alex' : 'bea'),
    body: `general ${i}`,
    createdAt: '2026-09-02T10:00:00Z',
    lastEditedAt: null,
    isMinimized: false,
    minimizedReason: null,
    url: `https://github.com/n10/fixture/pull/42#general-${i}`,
    viewerCanUpdate: i === 1,
    viewerCannotUpdateReasons: i === 1 ? [] : ['INSUFFICIENT_ACCESS'],
    viewerCanDelete: i === 1,
  };
}

function review(id: string, state: string, body: string, comments: number) {
  return {
    id,
    author: user('bea'),
    state,
    body,
    submittedAt: '2026-09-03T10:00:00Z',
    url: `https://github.com/n10/fixture/pull/42#${id}`,
    commit: { oid: OID_B },
    comments: { totalCount: comments },
    isMinimized: false,
    minimizedReason: null,
  };
}

interface Scenario {
  threads: FakeThread[];
  comments: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  events: Record<string, unknown>[];
  /** Counts reported instead of the true lengths. */
  totals?: Partial<Record<'threads' | 'comments' | 'reviews', number>>;
}

function q2(): Scenario {
  const threads = Array.from({ length: 130 }, (_, i) => thread(i + 1));
  const long = threads[6]!;
  for (let r = 1; r <= 125; r++) {
    long.comments.push(
      reviewComment(`thread-7-r${r}`, { replyTo: { id: 'thread-7-c1' } })
    );
  }
  return {
    threads,
    comments: Array.from({ length: 150 }, (_, i) => issueComment(i + 1)),
    reviews: [
      review('review-1', 'COMMENTED', 'A few questions inline.', 130),
      review('review-2', 'CHANGES_REQUESTED', 'Cleanup is missing.', 0),
      review('review-3', 'APPROVED', 'Summary only: looks right now.', 0),
    ],
    events: [],
  };
}

function pageOf<T>(all: T[], after: string | undefined, total?: number) {
  const start = after ? Number(after) : 0;
  const nodes = all.slice(start, start + 100);
  const end = start + nodes.length;
  return {
    totalCount: total ?? all.length,
    pageInfo: { hasNextPage: end < all.length, endCursor: String(end) },
    nodes,
  };
}

function threadNode(t: FakeThread) {
  return { ...t.node, comments: pageOf(t.comments, undefined) };
}

function connections(s: Scenario, after?: string) {
  return {
    reviewThreads: () => {
      const page = pageOf(s.threads, after, s.totals?.threads);
      return { ...page, nodes: page.nodes.map(threadNode) };
    },
    comments: () => pageOf(s.comments, after, s.totals?.comments),
    reviews: () => pageOf(s.reviews, after, s.totals?.reviews),
    // GitHub's filtered timeline reports no count the reader uses.
    timelineItems: () => ({
      ...pageOf(s.events, after),
      totalCount: undefined,
    }),
  };
}

function fakeGitHub(s: Scenario) {
  const calls: { query: string; vars: Record<string, string | number> }[] = [];
  const graphql: GraphQl = (query, vars) => {
    calls.push({ query, vars });
    const pr = (pullRequest: unknown) =>
      Promise.resolve({ data: { repository: { pullRequest } } });
    if (query === CONVERSATION_QUERY) {
      const c = connections(s);
      return pr({
        reviewThreads: c.reviewThreads(),
        comments: c.comments(),
        reviews: c.reviews(),
        timelineItems: c.timelineItems(),
      });
    }
    for (const [name, text] of Object.entries(CONNECTION_PAGE_QUERIES)) {
      if (query !== text) continue;
      const c = connections(s, String(vars.after));
      return pr({ [name]: c[name as keyof typeof c]() });
    }
    if (query === THREAD_REPLIES_QUERY) {
      const t = s.threads.find((x) => x.node.id === vars.thread)!;
      const comments = pageOf(t.comments, String(vars.after));
      return Promise.resolve({ data: { node: { comments } } });
    }
    throw new Error(`unexpected query ${query.slice(0, 60)}`);
  };
  return { graphql, calls };
}

// ── Completeness ───────────────────────────────────────────────────

describe('fetchGitHubConversation', () => {
  it('reads every thread, reply, comment and review past the first page (Q2)', async () => {
    const { graphql, calls } = fakeGitHub(q2());
    const c = await fetchGitHubConversation(graphql, REF);

    expect(c.threads).toHaveLength(130);
    expect(c.threads.find((t) => t.id === 'thread-7')!.comments).toHaveLength(
      126
    );
    expect(c.comments).toHaveLength(150);
    expect(c.reviews).toHaveLength(3);
    expect(c.coverage.threads).toEqual({
      loaded: 130,
      total: 130,
      complete: true,
    });
    expect(c.coverage.threadComments).toEqual({
      loaded: 129 + 126,
      total: 129 + 126,
      complete: true,
    });
    expect(c.coverage.comments.complete).toBe(true);
    expect(isConversationComplete(c)).toBe(true);
    // The first page of everything, then one more page of threads, of
    // comments, and of the long thread's replies.
    expect(calls).toHaveLength(4);
  });

  it('answers with the ref it was asked about', async () => {
    const { graphql } = fakeGitHub(q2());
    const c = await fetchGitHubConversation(graphql, REF);
    expect(c.ref).toEqual(REF);
  });

  it('reports a collection it stopped reading as incomplete', async () => {
    const s = q2();
    s.comments = Array.from({ length: (PAGE_LIMIT + 1) * 100 }, (_, i) =>
      issueComment(i + 1)
    );
    const { graphql } = fakeGitHub(s);
    const c = await fetchGitHubConversation(graphql, REF);

    expect(c.comments).toHaveLength(PAGE_LIMIT * 100);
    expect(c.coverage.comments).toEqual({
      loaded: PAGE_LIMIT * 100,
      total: (PAGE_LIMIT + 1) * 100,
      complete: false,
    });
    expect(isConversationComplete(c)).toBe(false);
  });

  it('reports fewer threads than GitHub counts as incomplete', async () => {
    const s = q2();
    s.totals = { threads: 131 };
    const { graphql } = fakeGitHub(s);
    const c = await fetchGitHubConversation(graphql, REF);
    expect(c.coverage.threads.complete).toBe(false);
    expect(isConversationComplete(c)).toBe(false);
  });

  it('stops at a next page GitHub names no cursor for', async () => {
    const { graphql, calls } = fakeGitHub({
      threads: [thread(1)],
      comments: [],
      reviews: [],
      events: [],
    });
    const wrapped: GraphQl = async (query, vars) => {
      const res = (await graphql(query, vars)) as {
        data: { repository: { pullRequest: Record<string, unknown> } };
      };
      const threads = res.data.repository.pullRequest.reviewThreads as
        | { pageInfo: unknown }
        | undefined;
      if (threads) threads.pageInfo = { hasNextPage: true, endCursor: null };
      return res;
    };
    const c = await fetchGitHubConversation(wrapped, REF);
    expect(c.threads).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('fails the whole read when a later page fails, keeping its kind', async () => {
    const { graphql } = fakeGitHub(q2());
    const failing: GraphQl = (query, vars) =>
      query === CONNECTION_PAGE_QUERIES.comments
        ? Promise.reject(throttledError('GitHub', 30_000))
        : graphql(query, vars);
    await expect(fetchGitHubConversation(failing, REF)).rejects.toMatchObject({
      kind: 'throttled',
      retryAfterMs: 30_000,
    });
  });

  it('refuses an answer that names no pull request', async () => {
    const graphql: GraphQl = () =>
      Promise.resolve({ data: { repository: { pullRequest: null } } });
    await expect(fetchGitHubConversation(graphql, REF)).rejects.toThrow(
      /no pull request #42/
    );
  });
});

// ── Provenance ─────────────────────────────────────────────────────

async function readOne(s: Partial<Scenario>) {
  const { graphql } = fakeGitHub({
    threads: [],
    comments: [],
    reviews: [],
    events: [],
    ...s,
  });
  return fetchGitHubConversation(graphql, REF);
}

describe('thread provenance', () => {
  it('keeps an outdated left-side thread on its original range and commit', async () => {
    const c = await readOne({
      threads: [
        thread(1, {
          isOutdated: true,
          line: null,
          startLine: null,
          originalLine: 20,
          originalStartLine: 18,
          diffSide: 'LEFT',
          startDiffSide: 'LEFT',
        }),
      ],
    });
    const t = c.threads[0]!;
    expect(t.isOutdated).toBe(true);
    expect(t.anchor).toEqual({
      path: 'src/request.ts',
      current: null,
      original: { startSide: 'LEFT', start: 18, side: 'LEFT', end: 20 },
      originalCommit: OID_A,
      iterations: null,
      diffHunk: '@@ -38,4 +38,6 @@ function run() {',
    });
  });

  it('keeps the current and original ranges of a thread GitHub moved', async () => {
    const c = await readOne({
      threads: [
        thread(1, {
          line: 43,
          startLine: 41,
          originalLine: 40,
          originalStartLine: 38,
        }),
      ],
    });
    expect(c.threads[0]!.anchor).toMatchObject({
      current: { startSide: 'RIGHT', start: 41, side: 'RIGHT', end: 43 },
      original: { startSide: 'RIGHT', start: 38, side: 'RIGHT', end: 40 },
    });
    expect(c.threads[0]!.scope).toBe('line');
  });

  it('keeps each end’s side for a range that starts on a removed line', async () => {
    const c = await readOne({
      threads: [
        thread(1, {
          line: 42,
          startLine: 40,
          originalLine: 42,
          originalStartLine: 40,
          diffSide: 'RIGHT',
          startDiffSide: 'LEFT',
        }),
      ],
    });
    const cross = { startSide: 'LEFT', start: 40, side: 'RIGHT', end: 42 };
    expect(c.threads[0]!.anchor).toMatchObject({
      current: cross,
      original: cross,
    });
  });

  it('marks the viewer’s unsubmitted comments as pending', async () => {
    const t = thread(1);
    t.comments = [reviewComment('c1', { state: 'PENDING' })];
    const c = await readOne({ threads: [t, thread(2)] });
    expect(c.threads[0]!.comments[0]!.pending).toBe(true);
    expect(c.threads[1]!.comments[0]!.pending).toBe(false);
  });

  it('reads a file-level thread as a file thread with no range', async () => {
    const c = await readOne({
      threads: [
        thread(1, {
          subjectType: 'FILE',
          path: 'assets/logo.png',
          line: null,
          originalLine: null,
        }),
      ],
    });
    expect(c.threads[0]).toMatchObject({
      scope: 'file',
      anchor: { path: 'assets/logo.png', current: null, original: null },
    });
    expect(c.threads[0]!.comments[0]!.capabilities.edit).toEqual({
      state: 'forbidden',
      reason: expect.any(String),
    });
  });

  it('names who resolved a thread, and nobody for an open one', async () => {
    const c = await readOne({
      threads: [
        thread(1, {
          isResolved: true,
          resolvedBy: user('alex'),
          viewerCanUnresolve: true,
        }),
        thread(2),
      ],
    });
    expect(c.threads[0]!.status).toEqual({
      resolved: true,
      native: 'resolved',
      resolvedBy: {
        identifier: 'alex',
        displayName: 'alex',
        id: null,
        kind: 'user',
      },
    });
    expect(c.threads[0]!.capabilities.resolve).toEqual({ state: 'supported' });
    expect(c.threads[1]!.status.resolvedBy).toBeNull();
  });

  it('says what the viewer may not do with a thread', async () => {
    const c = await readOne({
      threads: [thread(1, { viewerCanReply: false, viewerCanResolve: false })],
    });
    expect(c.threads[0]!.capabilities).toEqual({
      reply: { state: 'forbidden', reason: expect.any(String) },
      resolve: { state: 'forbidden', reason: expect.any(String) },
    });
  });
});

describe('comment provenance', () => {
  it('keeps the raw source apart from the display text', async () => {
    const s = q2();
    const t = thread(1);
    t.comments = [
      reviewComment('c1', { body: 'see \x1b[31mthis\x1b[0m @bea' }),
    ];
    const c = await readOne({ threads: [t], reviews: s.reviews });
    const comment = c.threads[0]!.comments[0]!;
    expect(comment.source).toBe('see \x1b[31mthis\x1b[0m @bea');
    expect(comment.body).toBe('see this @bea');
    expect(comment.reviewId).toBe('review-1');
  });

  it('labels a minimized comment and still delivers its text', async () => {
    const t = thread(1);
    t.comments = [
      reviewComment('c1', {
        isMinimized: true,
        minimizedReason: 'OUTDATED',
        body: 'old take',
      }),
    ];
    const c = await readOne({ threads: [t] });
    expect(c.threads[0]!.comments[0]).toMatchObject({
      minimized: { reason: 'outdated' },
      body: 'old take',
    });
  });

  it('keeps a deleted account as nobody and a bot as a bot', async () => {
    const first = { ...issueComment(1), author: null };
    const second = {
      ...issueComment(2),
      author: { __typename: 'Bot', login: 'ci-bot' },
    };
    const c = await readOne({ comments: [first, second] });
    expect(c.comments[0]!.author).toBeNull();
    expect(c.comments[1]!.author).toMatchObject({ kind: 'bot' });
  });

  it('says an archived repository, not the viewer, stops an edit', async () => {
    const archived = {
      ...issueComment(2),
      viewerCannotUpdateReasons: ['ARCHIVED'],
    };
    const c = await readOne({ comments: [archived] });
    expect(c.comments[0]!.capabilities.edit).toEqual({
      state: 'unavailable',
      reason: 'The repository is archived',
    });
  });

  it('keeps conversation comments out of the threads', async () => {
    const c = await readOne({ comments: [issueComment(1)] });
    expect(c.threads).toHaveLength(0);
    expect(c.comments[0]).toMatchObject({
      id: 'general-1',
      replyTo: null,
      capabilities: {
        edit: { state: 'supported' },
        delete: { state: 'supported' },
      },
    });
  });
});

describe('reviews and events', () => {
  it('reads a summary review with no inline comments, verdict and all', async () => {
    const c = await readOne({ reviews: q2().reviews });
    expect(c.reviews[2]).toMatchObject({
      state: 'approved',
      native: 'APPROVED',
      body: 'Summary only: looks right now.',
      commentCount: 0,
      commit: OID_B,
    });
    expect(c.reviews[1]!.state).toBe('changes-requested');
  });

  it('labels a hidden review summary', async () => {
    const hidden = {
      ...review('review-9', 'COMMENTED', 'spam', 0),
      isMinimized: true,
      minimizedReason: 'SPAM',
    };
    const c = await readOne({ reviews: [hidden] });
    expect(c.reviews[0]).toMatchObject({
      minimized: { reason: 'spam' },
      body: 'spam',
    });
  });

  it('reads the viewer’s unsubmitted review as pending', async () => {
    const c = await readOne({
      reviews: [review('mine', 'PENDING', '', 2)],
    });
    expect(c.reviews[0]).toMatchObject({ state: 'pending', commentCount: 2 });
  });

  it('reads pushes, requests and lifecycle events', async () => {
    const c = await readOne({
      events: [
        {
          __typename: 'PullRequestCommit',
          id: 'commit-1',
          commit: {
            oid: OID_A,
            committedDate: '2026-09-01T09:00:00Z',
            messageHeadline: 'Handle cancelled requests',
            author: { name: 'Alex Git', user: null },
          },
        },
        {
          __typename: 'HeadRefForcePushedEvent',
          id: 'push-1',
          createdAt: '2026-09-02T09:00:00Z',
          actor: user('alex'),
          beforeCommit: { oid: OID_A },
          afterCommit: { oid: OID_B },
        },
        {
          __typename: 'ReviewRequestedEvent',
          id: 'request-1',
          createdAt: '2026-09-02T09:30:00Z',
          actor: user('alex'),
          requestedReviewer: { __typename: 'Team', name: 'Core team' },
        },
        {
          __typename: 'ReadyForReviewEvent',
          id: 'ready-1',
          createdAt: '2026-09-02T09:40:00Z',
          actor: user('alex'),
        },
        { __typename: 'SomethingNewEvent', id: 'x' },
      ],
    });
    expect(c.events).toEqual([
      expect.objectContaining({
        kind: 'commit',
        commit: OID_A,
        headline: 'Handle cancelled requests',
        // A name git recorded is not an account.
        actor: null,
        authorName: 'Alex Git',
        at: '2026-09-01T09:00:00Z',
      }),
      expect.objectContaining({
        kind: 'force-push',
        before: OID_A,
        after: OID_B,
      }),
      expect.objectContaining({
        kind: 'review-requested',
        reviewer: { kind: 'team', name: 'Core team' },
      }),
      expect.objectContaining({ kind: 'ready-for-review' }),
    ]);
    expect(c.coverage.events).toEqual({
      loaded: 5,
      total: null,
      complete: true,
    });
  });
});
