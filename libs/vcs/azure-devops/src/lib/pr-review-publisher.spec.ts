import { describe, expect, it } from 'vitest';
import {
  ReviewPublishError,
  VcsError,
  type ReviewLedger,
  type ReviewSubmission,
} from '@n10/vcs-core';
import {
  publishAzureReview,
  type AdoReviewApi,
} from './pr-review-publisher.js';
import type { AdoReviewThread } from './pr-review-threads.js';

const HEAD = 'a'.repeat(40);
const ME = 'me-guid';

/**
 * Azure DevOps's side, as its pull request REST API documents it:
 * threads and their comments, iterations with their source commits and
 * changes, and each reviewer's vote. `lose` performs a write and drops
 * its answer; `refuse` answers 400 and writes nothing.
 */
class FakeAzure implements AdoReviewApi {
  head = HEAD;
  iterations = [
    { id: 1, commit: 'c'.repeat(40) },
    { id: 2, commit: HEAD },
  ];
  changes = [
    { changeTrackingId: 7, item: { path: '/src/cancel.ts' } },
    { changeTrackingId: 9, item: { path: '/yarn.lock' } },
  ];
  pageSize = 100;
  threads: AdoReviewThread[] = [
    {
      id: 40,
      threadContext: null,
      comments: [{ id: 1, content: 'Why?', author: { id: 'alex' } }],
    },
  ];
  votes = new Map<string, number>();
  writes: { method: string; path: string; body: Record<string, unknown> }[] =
    [];
  lose = new Set<string>();
  refuse = new Set<string>();
  private next = 100;

  me = () => Promise.resolve(ME);

  get = <T>(path: string): Promise<T> => {
    const p = path.split('?')[0]!;
    const query = new URLSearchParams(path.split('?')[1]);
    if (/^pullrequests\/\d+$/.test(p)) {
      return this.ok({ lastMergeSourceCommit: { commitId: this.head } });
    }
    if (p.endsWith('/iterations')) {
      return this.ok({
        value: this.iterations.map((i) => ({
          id: i.id,
          sourceRefCommit: { commitId: i.commit },
        })),
      });
    }
    if (p.endsWith('/changes')) {
      const skip = Number(query.get('$skip') ?? 0);
      const page = this.changes.slice(skip, skip + this.pageSize);
      const more = skip + this.pageSize < this.changes.length;
      return this.ok({
        changeEntries: page,
        ...(more ? { nextSkip: skip + this.pageSize } : {}),
      });
    }
    if (p.endsWith('/threads')) return this.ok({ value: this.threads });
    const one = /threads\/(\d+)$/.exec(p);
    if (one) return this.ok(this.threads.find((t) => t.id === Number(one[1])));
    throw new Error(`unexpected GET ${path}`);
  };

  send = <T>(
    method: 'POST' | 'PUT',
    path: string,
    body: unknown
  ): Promise<T> => {
    const p = path.split('?')[0]!;
    const b = body as Record<string, unknown>;
    const op =
      method === 'PUT' ? 'vote' : p.endsWith('/comments') ? 'reply' : 'thread';
    if (this.refuse.delete(op)) {
      return Promise.reject(
        new VcsError('server', 'Azure DevOps: TF401181: thread is closed', {
          status: 400,
        })
      );
    }
    this.writes.push({ method, path: p, body: b });
    const answer = this.write(op, p, b);
    if (this.lose.delete(op)) {
      return Promise.reject(new VcsError('network', 'connection reset'));
    }
    return this.ok<T>(answer);
  };

  private write(op: string, p: string, b: Record<string, unknown>) {
    if (op === 'vote') {
      this.votes.set(ME, Number(b['vote']));
      return { vote: b['vote'] };
    }
    const id = ++this.next;
    if (op === 'reply') {
      const thread = this.threads.find(
        (t) => t.id === Number(/threads\/(\d+)\//.exec(p)![1])
      )!;
      thread.comments!.push({
        id,
        parentCommentId: Number(b['parentCommentId']),
        content: String(b['content']),
        author: { id: ME },
      });
      return { id };
    }
    const [first] = b['comments'] as { content: string }[];
    this.threads.push({
      id,
      threadContext: (b['threadContext'] ??
        null) as AdoReviewThread['threadContext'],
      comments: [{ id: 1, content: first!.content, author: { id: ME } }],
    });
    return { id };
  }

  private ok<T>(value: unknown): Promise<T> {
    return Promise.resolve(value as T);
  }
}

function memory() {
  let ledger: ReviewLedger | null = null;
  return {
    read: () => ledger,
    write: (l: ReviewLedger) => {
      ledger = l;
    },
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
        range: { startSide: 'LEFT', start: 3, side: 'LEFT', end: 5 },
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
      place: { kind: 'reply', threadId: '40' },
    },
  ],
};

function publish(ado: FakeAzure, store = memory(), sub = SUBMISSION) {
  return publishAzureReview(ado, sub, store);
}

const failed = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => {
      if (!(e instanceof ReviewPublishError)) throw e;
      return e;
    }
  );

const posts = (ado: FakeAzure) =>
  ado.writes.filter((w) => w.method === 'POST').length;

describe('publishing an Azure DevOps review', () => {
  it('posts each comment on its side and revision, then the summary, then the vote', async () => {
    const ado = new FakeAzure();
    const published = await publish(ado);
    expect(ado.writes.map((w) => w.method)).toEqual([
      'POST',
      'POST',
      'POST',
      'POST',
      'PUT',
    ]);
    expect(ado.writes[0]!.body).toMatchObject({
      threadContext: {
        filePath: '/src/cancel.ts',
        leftFileStart: { line: 3, offset: 1 },
        leftFileEnd: { line: 5, offset: 1 },
      },
      pullRequestThreadContext: {
        iterationContext: {
          firstComparingIteration: 1,
          secondComparingIteration: 2,
        },
        changeTrackingId: 7,
      },
    });
    expect(ado.writes[1]!.body['threadContext']).toEqual({
      filePath: '/yarn.lock',
    });
    // The reply hangs off the thread's first comment.
    expect(ado.writes[2]!.body).toMatchObject({
      parentCommentId: 1,
      content: 'Agreed.',
    });
    expect(ado.writes[3]!.body).not.toHaveProperty('threadContext');
    expect(ado.votes.get(ME)).toBe(10);
    expect(Object.keys(published.items)).toEqual([
      'range',
      'file',
      'reply',
      'summary',
    ]);
  });

  it('casts no vote for a comment, and 0 to reset one', async () => {
    const ado = new FakeAzure();
    await publish(ado, memory(), { ...SUBMISSION, event: 'COMMENT' });
    expect(ado.votes.has(ME)).toBe(false);
    const reset = new FakeAzure();
    await publish(reset, memory(), { ...SUBMISSION, event: 'RESET_VOTE' });
    expect(reset.votes.get(ME)).toBe(0);
  });

  it('refuses a verdict Azure does not have, and a moved head, before any write', async () => {
    const ado = new FakeAzure();
    const bad = await failed(
      publish(ado, memory(), { ...SUBMISSION, event: 'REQUEST_CHANGES' })
    );
    expect(bad?.failure).toBe('refused');
    ado.head = 'b'.repeat(40);
    expect((await failed(publish(ado)))?.failure).toBe('moved');
    expect(ado.writes).toEqual([]);
  });

  it('casts no vote when a comment is refused, says what was posted, and sends only the rest after', async () => {
    const ado = new FakeAzure();
    const store = memory();
    ado.refuse.add('reply');
    const err = await failed(publish(ado, store));
    expect(err).toMatchObject({ failure: 'refused', item: 'reply' });
    expect(Object.keys(err!.posted)).toEqual(['range', 'file']);
    expect(ado.votes.has(ME)).toBe(false);

    await publish(ado, store);
    expect(posts(ado)).toBe(4);
    expect(ado.votes.get(ME)).toBe(10);
  });

  it('finds a thread whose answer was lost instead of posting it again', async () => {
    const ado = new FakeAzure();
    const store = memory();
    ado.lose.add('thread');
    const err = await failed(publish(ado, store));
    expect(err?.failure).toBe('unknown');
    const published = await publish(ado, store);
    expect(posts(ado)).toBe(4);
    expect(published.items['range']).toBe('101');
  });

  it('finds a reply whose answer was lost in its own thread', async () => {
    const ado = new FakeAzure();
    const store = memory();
    ado.lose.add('reply');
    await failed(publish(ado, store));
    await publish(ado, store);
    expect(ado.writes.filter((w) => w.path.endsWith('/comments'))).toHaveLength(
      1
    );
  });

  it('sends a vote whose answer was lost again, and nothing else', async () => {
    const ado = new FakeAzure();
    const store = memory();
    ado.lose.add('vote');
    expect((await failed(publish(ado, store)))?.failure).toBe('unknown');
    await publish(ado, store);
    expect(posts(ado)).toBe(4);
    expect(ado.writes.filter((w) => w.method === 'PUT')).toHaveLength(2);
    expect(ado.votes.get(ME)).toBe(10);
  });

  it('does not take another reviewer’s thread with the same text for its own', async () => {
    const ado = new FakeAzure();
    const store = memory();
    ado.threads.push({
      id: 41,
      threadContext: { filePath: '/yarn.lock' },
      comments: [{ id: 1, content: 'Generated?', author: { id: 'alex' } }],
    });
    ado.lose.add('thread');
    await failed(
      publish(ado, store, { ...SUBMISSION, items: [SUBMISSION.items[1]!] })
    );
    ado.threads = ado.threads.filter((t) => t.id !== 101);
    await publish(ado, store, { ...SUBMISSION, items: [SUBMISSION.items[1]!] });
    expect(posts(ado)).toBe(3);
  });

  it('waits for Azure to record the reviewed commit before commenting on code', async () => {
    const ado = new FakeAzure();
    ado.iterations = [{ id: 1, commit: 'c'.repeat(40) }];
    const err = await failed(publish(ado));
    expect(err?.failure).toBe('moved');
    expect(ado.writes).toEqual([]);
  });

  it('reads every page of the iteration’s changes', async () => {
    const ado = new FakeAzure();
    ado.pageSize = 1;
    await publish(ado);
    expect(ado.writes[1]!.body).toMatchObject({
      pullRequestThreadContext: { changeTrackingId: 9 },
    });
  });
});
