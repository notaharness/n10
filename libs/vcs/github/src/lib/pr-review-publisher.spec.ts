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
  replyTo: { id: string } | null;
}

/**
 * GitHub's side of a review, as its GraphQL schema describes it: one
 * pending review per reviewer, visible only to them, filled by thread
 * and reply mutations and filed by a submit. `lose` performs a write
 * and then drops its answer; `refuse` answers no and writes nothing.
 */
class FakeGitHub {
  head = HEAD;
  pending: { id: string; createdAt: string; comments: Comment[] } | null = null;
  states = new Map<string, string>();
  sent: string[] = [];
  submitted: Record<string, unknown>[] = [];
  lose = new Set<string>();
  refuse = new Map<string, string>();
  clock = 1_000_000;
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
    const data = this.answer(op, query, v);
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
                        comments: { nodes: this.pending.comments },
                      },
                    ]
                  : [],
              },
            },
          },
        };
      case 'ReviewPublicationById':
        return {
          node: this.states.has(String(v['id']))
            ? { id: v['id'], state: this.states.get(String(v['id'])) }
            : null,
        };
      default:
        throw new Error(`unexpected ${op}`);
    }
  }

  private write(op: string, query: string, v: Record<string, unknown>) {
    switch (op) {
      case 'StartReview': {
        const id = this.id('PRR');
        this.pending = {
          id,
          createdAt: new Date(this.clock).toISOString(),
          comments: [],
        };
        this.states.set(id, 'PENDING');
        return { addPullRequestReview: { pullRequestReview: { id } } };
      }
      case 'AddReviewThread': {
        const id = this.id('PRRC');
        this.pending!.comments.push({
          id,
          body: String(v['body']),
          path: String(v['path']),
          replyTo: null,
        });
        const file = query.includes('subjectType: FILE');
        return {
          addPullRequestReviewThread: {
            thread: { id: this.id('PRRT'), comments: { nodes: [{ id }] } },
            file,
          },
        };
      }
      case 'AddReviewReply': {
        const id = this.id('PRRC');
        this.pending!.comments.push({
          id,
          body: String(v['body']),
          path: 'x',
          replyTo: { id: 'earlier' },
        });
        return { addPullRequestReviewThreadReply: { comment: { id } } };
      }
      case 'UpdateReviewComment': {
        const c = this.pending!.comments.find((x) => x.id === v['id'])!;
        c.body = String(v['body']);
        return {
          updatePullRequestReviewComment: {
            pullRequestReviewComment: { id: c.id },
          },
        };
      }
      case 'DeleteReviewComment': {
        const at = this.pending!.comments.findIndex((c) => c.id === v['id']);
        this.pending!.comments.splice(at, 1);
        return {
          deletePullRequestReviewComment: {
            pullRequestReview: { id: this.pending!.id },
          },
        };
      }
      case 'SubmitReview': {
        const id = String(v['review']);
        this.states.set(
          id,
          v['event'] === 'APPROVE' ? 'APPROVED' : 'COMMENTED'
        );
        this.submitted.push({ ...v, comments: this.pending!.comments.length });
        this.pending = null;
        return { submitPullRequestReview: { pullRequestReview: { id } } };
      }
      case 'DeletePendingReview':
        this.states.delete(String(v['review']));
        this.pending = null;
        return {
          deletePullRequestReview: { pullRequestReview: { id: v['review'] } },
        };
      default:
        throw new Error(`unexpected ${op}`);
    }
  }
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
    expect(store.get()).toMatchObject({ submitted: true, inFlight: null });
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
    await publish(gh, store);
    expect(gh.submitted).toHaveLength(1);
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
    gh.pending = {
      id: 'PRR_web',
      createdAt: '2020-01-01T00:00:00Z',
      comments: [],
    };
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
});
