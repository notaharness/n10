import { describe, expect, it } from 'vitest';
import {
  ReviewPublishError,
  VcsError,
  type ReviewLedger,
  type ReviewSubmission,
} from '@n10/vcs-core';
import { publishGitHubReview } from './pr-review-publisher.js';

const HEAD = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const REPO = { provider: 'github', host: 'github.com', repository: 'acme/app' };

interface Comment {
  id: string;
  body: string;
  path: string;
  line: number | null;
  startLine: number | null;
  subjectType: 'LINE' | 'FILE';
  replyTo: { id: string } | null;
}

interface Pending {
  id: string;
  viewerDidAuthor: boolean;
  commit: { oid: string };
  comments: Comment[];
}

/** Each existing thread's first comment, which its replies answer. */
const ROOTS: Record<string, string> = {
  PRRT_old: 'PRRC_old',
  PRRT_other: 'PRRC_other',
};

/**
 * GitHub's side of a review, as its GraphQL schema describes it: one
 * pending review per reviewer, visible only to them, filled by thread
 * and reply mutations and filed by a submit. `lose` performs a write
 * and then drops its answer; `drop` loses the request before it
 * reaches GitHub; `refuse` answers no and writes nothing.
 * What GitHub itself refuses (a second pending review, a submit of one
 * already filed, a comment that is not there) is refused here too.
 */
class FakeGitHub {
  head = HEAD;
  pending: Pending | null = null;
  pageSize = 100;
  states = new Map<string, string>();
  sent: string[] = [];
  submitted: Record<string, unknown>[] = [];
  threadWrites: Record<string, unknown>[] = [];
  lose = new Set<string>();
  drop = new Set<string>();
  refuse = new Map<string, string>();
  clock = Date.parse('2026-09-01T00:00:00Z');
  private next = 0;

  gql = (query: string, v: Record<string, string | number>) => {
    const op = /(?:query|mutation) (\w+)/.exec(query)![1]!;
    this.sent.push(op);
    const refusal = this.refuse.get(op);
    if (refusal) {
      this.refuse.delete(op);
      return Promise.reject(
        new VcsError('server', `GitHub refused: ${refusal}`, { refused: true })
      );
    }
    if (this.drop.delete(op)) {
      return Promise.reject(new VcsError('network', 'connection refused'));
    }
    let data: unknown;
    try {
      data = this.answer(op, query, v);
    } catch (err) {
      return Promise.reject(err as Error);
    }
    if (this.lose.delete(op)) {
      return Promise.reject(new VcsError('network', 'connection reset'));
    }
    return Promise.resolve({ data });
  };

  private id(prefix: string) {
    return `${prefix}_${++this.next}`;
  }

  private answer(op: string, query: string, v: Record<string, unknown>) {
    return op.startsWith('ReviewPublication')
      ? this.read(op, v)
      : this.write(op, query, v);
  }

  private read(op: string, v: Record<string, unknown>) {
    switch (op) {
      case 'ReviewPublicationState':
        return {
          repository: {
            pullRequest: {
              id: 'PR_1',
              headRefOid: this.head,
              reviews: {
                nodes: this.pending
                  ? [
                      {
                        ...this.pending,
                        comments: { totalCount: this.pending.comments.length },
                      },
                    ]
                  : [],
              },
            },
          },
        };
      case 'ReviewPublicationComments': {
        const pending = this.pending;
        if (pending?.id !== v['id']) return { node: null };
        const from = v['after'] ? Number(v['after']) : 0;
        const to = from + this.pageSize;
        const all = pending!.comments;
        return {
          node: {
            comments: {
              pageInfo: {
                hasNextPage: to < all.length,
                endCursor: String(to),
              },
              nodes: all.slice(from, to),
            },
          },
        };
      }
      case 'ReviewPublicationThreadRoot': {
        const root = ROOTS[String(v['id'])];
        return { node: root ? { comments: { nodes: [{ id: root }] } } : null };
      }
      case 'ReviewPublicationById': {
        // GitHub answers a node that is gone with NOT_FOUND, not null.
        const state = this.states.get(String(v['id']));
        if (!state) throw gone();
        return { node: { id: v['id'], state } };
      }
      default:
        throw new Error(`unexpected ${op}`);
    }
  }

  private write(op: string, query: string, v: Record<string, unknown>) {
    const write = this.writes[op];
    if (!write) throw new Error(`unexpected ${op}`);
    return write(v, query);
  }

  private readonly writes: Record<
    string,
    (v: Record<string, unknown>, query: string) => unknown
  > = {
    StartReview: (v) => {
      if (this.pending) throw refused('one pending review per reviewer');
      const id = this.id('PRR');
      this.pending = {
        id,
        viewerDidAuthor: true,
        commit: { oid: String(v['commit']) },
        comments: [],
      };
      this.states.set(id, 'PENDING');
      return { addPullRequestReview: { pullRequestReview: { id } } };
    },
    AddReviewThread: (v, query) => {
      const id = this.id('PRRC');
      const file = query.includes('subjectType: FILE');
      this.pending!.comments.push({
        id,
        body: String(v['body']),
        path: String(v['path']),
        line: file ? null : Number(v['line']),
        startLine: v['startLine'] ? Number(v['startLine']) : null,
        subjectType: file ? 'FILE' : 'LINE',
        replyTo: null,
      });
      this.threadWrites.push({ ...v });
      return {
        addPullRequestReviewThread: {
          thread: { id: this.id('PRRT'), comments: { nodes: [{ id }] } },
          file,
        },
      };
    },
    AddReviewReply: (v) => {
      const id = this.id('PRRC');
      this.pending!.comments.push({
        id,
        body: String(v['body']),
        path: 'x',
        line: 1,
        startLine: null,
        subjectType: 'LINE',
        replyTo: { id: ROOTS[String(v['thread'])] ?? 'PRRC_unknown' },
      });
      return { addPullRequestReviewThreadReply: { comment: { id } } };
    },
    UpdateReviewComment: (v) => {
      const c = this.pending!.comments.find((x) => x.id === v['id'])!;
      c.body = String(v['body']);
      return {
        updatePullRequestReviewComment: {
          pullRequestReviewComment: { id: c.id },
        },
      };
    },
    DeleteReviewComment: (v) => {
      const at = this.pending?.comments.findIndex((c) => c.id === v['id']);
      if (at == null || at < 0) throw gone();
      this.pending!.comments.splice(at, 1);
      return {
        deletePullRequestReviewComment: {
          pullRequestReview: { id: this.pending!.id },
        },
      };
    },
    SubmitReview: (v) => {
      const id = String(v['review']);
      if (this.pending?.id !== id) throw refused('review is not pending');
      this.states.set(id, v['event'] === 'APPROVE' ? 'APPROVED' : 'COMMENTED');
      this.submitted.push({ ...v, comments: this.pending!.comments.length });
      this.pending = null;
      return { submitPullRequestReview: { pullRequestReview: { id } } };
    },
    DeletePendingReview: (v) => {
      this.states.delete(String(v['review']));
      this.pending = null;
      return {
        deletePullRequestReview: { pullRequestReview: { id: v['review'] } },
      };
    },
  };
}

function refused(why: string) {
  return new VcsError('server', `GitHub refused: ${why}`, { refused: true });
}

function gone() {
  return new VcsError('not-found', 'Could not resolve to a node', {
    refused: true,
  });
}

function memory() {
  let ledger: ReviewLedger | null = null;
  return {
    read: () => ledger,
    write: (l: ReviewLedger) => {
      ledger = l;
    },
    get: () => ledger,
  };
}

const SUBMISSION: ReviewSubmission = {
  prId: 7,
  head: HEAD,
  event: 'APPROVE',
  body: 'Looks right.',
  items: [
    {
      key: 'range',
      body: 'Does this also clear the handle?',
      place: {
        kind: 'line',
        path: 'src/cancel.ts',
        range: { startSide: 'RIGHT', start: 3, side: 'RIGHT', end: 5 },
      },
    },
    {
      key: 'file',
      body: 'Generated?',
      place: { kind: 'file', path: 'yarn.lock' },
    },
    {
      key: 'reply',
      body: 'Agreed.',
      place: { kind: 'reply', threadId: 'PRRT_old' },
    },
  ],
};

function publish(gh: FakeGitHub, store = memory(), sub = SUBMISSION) {
  return publishGitHubReview(gh.gql, REPO, sub, store, () => gh.clock);
}

const web = (): Pending => ({
  id: 'PRR_web',
  viewerDidAuthor: true,
  commit: { oid: HEAD },
  comments: [],
});

const count = (gh: FakeGitHub, op: string) =>
  gh.sent.filter((o) => o === op).length;

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof ReviewPublishError ? e.failure : e)
  );

describe('publishing a GitHub review', () => {
  it('files one review on the reviewed commit, with every comment in it', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    const published = await publish(gh, store);
    expect(gh.submitted).toEqual([
      { review: 'PRR_1', event: 'APPROVE', body: 'Looks right.', comments: 3 },
    ]);
    expect(Object.keys(published.items)).toEqual(['range', 'file', 'reply']);
    expect(published.resumed).toBe(false);
    expect(store.get()).toMatchObject({ submitted: true, inFlight: null });
    expect(gh.threadWrites[0]).toMatchObject({
      path: 'src/cancel.ts',
      startLine: 3,
      startSide: 'RIGHT',
      line: 5,
      side: 'RIGHT',
    });
  });

  it('refuses a pull request that has moved on, and writes nothing', async () => {
    const gh = new FakeGitHub();
    gh.head = NEWER;
    expect(await failure(publish(gh))).toBe('moved');
    expect(gh.sent).toEqual(['ReviewPublicationState']);
  });

  it('never submits twice when the submit’s answer was lost', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.lose.add('SubmitReview');
    expect(await failure(publish(gh, store))).toBe('unknown');
    expect(store.get()?.inFlight).toBe('submit');
    const published = await publish(gh, store);
    expect(gh.submitted).toHaveLength(1);
    expect(published.resumed).toBe(true);
  });

  it('finds a comment whose answer was lost instead of adding it again', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.lose.add('AddReviewThread');
    expect(await failure(publish(gh, store))).toBe('unknown');
    await publish(gh, store);
    expect(gh.sent.filter((op) => op === 'AddReviewThread')).toHaveLength(2);
    expect(gh.submitted[0]).toMatchObject({ comments: 3 });
  });

  it('takes up its own pending review when the start’s answer was lost', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.lose.add('StartReview');
    expect(await failure(publish(gh, store))).toBe('unknown');
    await publish(gh, store);
    expect(gh.sent.filter((op) => op === 'StartReview')).toHaveLength(1);
    expect(gh.submitted).toHaveLength(1);
  });

  it('leaves a pending review the reviewer started elsewhere alone', async () => {
    const gh = new FakeGitHub();
    gh.pending = web();
    expect(await failure(publish(gh))).toBe('blocked');
    expect(gh.sent).not.toContain('StartReview');
  });

  it('stops on a refusal with nothing in flight, and carries on after it', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.refuse.set('AddReviewReply', 'thread is locked');
    expect(await failure(publish(gh, store))).toBe('refused');
    expect(store.get()).toMatchObject({ inFlight: null, submitted: false });
    await publish(gh, store);
    expect(gh.sent.filter((op) => op === 'StartReview')).toHaveLength(1);
    expect(gh.submitted[0]).toMatchObject({ comments: 3 });
  });

  it('sends the edited text of a comment already in the pending review', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.refuse.set('SubmitReview', 'try again');
    await failure(publish(gh, store));
    const edited = {
      ...SUBMISSION,
      items: SUBMISSION.items.map((i) =>
        i.key === 'file' ? { ...i, body: 'Generated? Say so.' } : i
      ),
    };
    await publish(gh, store, edited);
    expect(gh.sent.filter((op) => op === 'UpdateReviewComment')).toHaveLength(
      1
    );
    expect(gh.sent.filter((op) => op === 'AddReviewThread')).toHaveLength(2);
  });

  it('starts again on a new head, discarding its pending review on the old one', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.refuse.set('SubmitReview', 'try again');
    await failure(publish(gh, store));
    gh.head = NEWER;
    await publish(gh, store, { ...SUBMISSION, head: NEWER });
    expect(gh.sent).toContain('DeletePendingReview');
    expect(gh.sent.filter((op) => op === 'StartReview')).toHaveLength(2);
    expect(gh.submitted).toHaveLength(1);
  });

  it('takes out a comment an earlier attempt added for a draft no longer chosen', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.refuse.set('SubmitReview', 'try again');
    await failure(publish(gh, store));
    const fewer = {
      ...SUBMISSION,
      items: SUBMISSION.items.filter((i) => i.key !== 'reply'),
    };
    const published = await publish(gh, store, fewer);
    expect(gh.sent).toContain('DeleteReviewComment');
    expect(gh.submitted[0]).toMatchObject({ comments: 2 });
    expect(Object.keys(published.items)).toEqual(['range', 'file']);
  });

  it('takes out a comment whose answer was lost when its draft is no longer chosen', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.lose.add('AddReviewThread');
    expect(await failure(publish(gh, store))).toBe('unknown');
    const fewer = {
      ...SUBMISSION,
      items: SUBMISSION.items.filter((i) => i.key !== 'range'),
    };
    const published = await publish(gh, store, fewer);
    expect(count(gh, 'DeleteReviewComment')).toBe(1);
    expect(gh.submitted[0]).toMatchObject({ comments: 2 });
    expect(Object.keys(published.items)).toEqual(['file', 'reply']);
  });

  it('does not send a take-out again once it is found to have landed', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.refuse.set('SubmitReview', 'try again');
    await failure(publish(gh, store));
    const fewer = {
      ...SUBMISSION,
      items: SUBMISSION.items.filter((i) => i.key !== 'reply'),
    };
    gh.lose.add('DeleteReviewComment');
    expect(await failure(publish(gh, store, fewer))).toBe('unknown');
    await publish(gh, store, fewer);
    expect(count(gh, 'DeleteReviewComment')).toBe(1);
    expect(gh.submitted[0]).toMatchObject({ comments: 2 });
  });

  it('finds a lost comment past the first page of the pending review', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.pageSize = 1;
    gh.lose.add('AddReviewReply');
    expect(await failure(publish(gh, store))).toBe('unknown');
    await publish(gh, store);
    expect(count(gh, 'AddReviewReply')).toBe(1);
    expect(count(gh, 'ReviewPublicationComments')).toBe(3);
    expect(gh.submitted[0]).toMatchObject({ comments: 3 });
  });

  it('tells a lost comment from an earlier one that says the same in the same place', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    const twice: ReviewSubmission = {
      ...SUBMISSION,
      items: [
        {
          key: 'a',
          body: 'Generated?',
          place: { kind: 'file', path: 'x.lock' },
        },
        {
          key: 'b',
          body: 'Generated?',
          place: { kind: 'file', path: 'x.lock' },
        },
      ],
    };
    let adds = 0;
    const gql = gh.gql;
    gh.gql = (query, v) => {
      if (query.includes('AddReviewThread') && ++adds === 2) {
        gh.lose.add('AddReviewThread');
      }
      return gql(query, v);
    };
    expect(await failure(publish(gh, store, twice))).toBe('unknown');
    const published = await publish(gh, store, twice);
    expect(adds).toBe(2);
    expect(published.items['a']).not.toBe(published.items['b']);
  });

  it('discards its own review from a lost start once the pull request has moved on', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.lose.add('StartReview');
    expect(await failure(publish(gh, store))).toBe('unknown');
    gh.head = NEWER;
    await publish(gh, store, { ...SUBMISSION, head: NEWER });
    expect(gh.sent).toContain('DeletePendingReview');
    expect(count(gh, 'StartReview')).toBe(2);
    expect(gh.submitted).toHaveLength(1);
    expect(store.get()?.head).toBe(NEWER);
  });

  it('does not take up a pending review filled on GitHub after its own start was lost', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.drop.add('StartReview');
    await failure(publish(gh, store));
    gh.pending = {
      ...web(),
      comments: [
        {
          id: 'PRRC_web',
          body: 'Mine, from the web.',
          path: 'a.ts',
          line: 1,
          startLine: null,
          subjectType: 'LINE',
          replyTo: null,
        },
      ],
    };
    expect(await failure(publish(gh, store))).toBe('blocked');
    expect(gh.pending.comments).toHaveLength(1);
  });

  it('starts over when its pending review was discarded on GitHub', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.refuse.set('SubmitReview', 'try again');
    await failure(publish(gh, store));
    gh.states.delete(gh.pending!.id);
    gh.pending = null;
    await publish(gh, store);
    expect(count(gh, 'StartReview')).toBe(2);
    expect(gh.submitted[0]).toMatchObject({ comments: 3 });
  });

  it('knows a lost submit did not land when the review is still pending', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.drop.add('SubmitReview');
    expect(await failure(publish(gh, store))).toBe('unknown');
    gh.head = NEWER;
    expect(await failure(publish(gh, store))).toBe('moved');
    expect(store.get()?.inFlight).toBeNull();
  });

  it('does not take up a pending review on another commit after its own lost start', async () => {
    const gh = new FakeGitHub();
    const store = memory();
    gh.lose.add('StartReview');
    await failure(publish(gh, store));
    gh.pending = {
      ...web(),
      commit: { oid: NEWER },
    };
    expect(await failure(publish(gh, store))).toBe('blocked');
  });

  it('names the item a refusal stopped at', async () => {
    const gh = new FakeGitHub();
    gh.refuse.set('AddReviewReply', 'thread is locked');
    const err = await publish(gh).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewPublishError);
    expect((err as ReviewPublishError).item).toBe('reply');
  });
});
