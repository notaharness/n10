import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ReviewPublishError,
  type LedgerStore,
  type PullRequestRef,
  type ReviewSubmission,
} from '@n10/vcs-core';
import { PullRequestIdentityError } from './pr-snapshot.js';
import { readDraftFile } from './review-draft-store.js';
import { listReviewDrafts, saveReviewDraft } from './review-drafts.js';
import {
  parseSubmitReviewRequest,
  submitReview,
  type SubmitSources,
} from './submit-review.js';

const REPO = { provider: 'github', host: 'github.com', repository: 'acme/app' };
const REF: PullRequestRef = { ...REPO, number: 42 };
const HEAD = 'a'.repeat(40);
const inline = (key: string, range = true) => ({
  kind: 'inline' as const,
  key,
  anchor: {
    path: 'src/cancel.ts',
    previousPath: null,
    range: range
      ? {
          startSide: 'RIGHT' as const,
          start: 3,
          side: 'RIGHT' as const,
          end: 5,
        }
      : null,
    head: null,
    lines: range ? ['a', 'b', 'c'] : [],
  },
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-submit-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Publish = NonNullable<SubmitSources['publish']>;

function src(publish?: Publish): SubmitSources {
  return {
    repository: () => REPO,
    viewer: () => 'bea',
    dir,
    now: () => 1000,
    publish,
  };
}

function write(
  target: Parameters<typeof saveReviewDraft>[0]['target'],
  body: string
) {
  saveReviewDraft({ ref: REF, viewer: 'bea', target, body }, src());
}

const request = (draftIds: string[], event = 'APPROVE' as const) => ({
  ref: REF,
  viewer: 'bea',
  head: HEAD,
  event,
  draftIds,
});

const states = () =>
  Object.fromEntries(
    listReviewDrafts({ ref: REF, viewer: 'bea' }, src()).drafts.map((d) => [
      d.id,
      d.publication.state,
    ])
  );

beforeEach(() => {
  write({ kind: 'summary' }, 'Looks right.');
  write(inline('k1'), 'Does this clear the handle?');
  write(inline('k2', false), 'Generated?');
  write({ kind: 'reply', threadId: 'PRRT_1' }, 'Agreed.');
  write({ kind: 'general' }, 'Thanks all.');
});

describe('submitting a review', () => {
  it('files the chosen drafts as one review and marks each posted', async () => {
    let sent: ReviewSubmission | null = null;
    await submitReview(
      parseSubmitReviewRequest(
        request(['summary', 'inline:k1', 'inline:k2', 'reply:PRRT_1'])
      ),
      src((submission, ledger) => {
        sent = submission;
        ledger.write({
          startedAt: 1,
          head: HEAD,
          reviewId: 'R',
          inFlight: null,
          added: {},
          submitted: true,
        });
        return Promise.resolve({
          reviewId: 'R',
          items: { 'inline:k1': 'C1', 'inline:k2': 'C2', 'reply:PRRT_1': 'C3' },
        });
      })
    );
    expect(sent).toEqual({
      prId: 42,
      head: HEAD,
      event: 'APPROVE',
      body: 'Looks right.',
      items: [
        {
          key: 'inline:k1',
          body: 'Does this clear the handle?',
          place: {
            kind: 'line',
            path: 'src/cancel.ts',
            range: { startSide: 'RIGHT', start: 3, side: 'RIGHT', end: 5 },
          },
        },
        {
          key: 'inline:k2',
          body: 'Generated?',
          place: { kind: 'file', path: 'src/cancel.ts' },
        },
        {
          key: 'reply:PRRT_1',
          body: 'Agreed.',
          place: { kind: 'reply', threadId: 'PRRT_1' },
        },
      ],
    });
    expect(states()).toEqual({
      summary: 'published',
      'inline:k1': 'published',
      'inline:k2': 'published',
      'reply:PRRT_1': 'published',
      general: 'unpublished',
    });
    expect(readDraftFile(dir, REF, 'bea').submission).toBeUndefined();
  });

  it('keeps an unanswered review to be looked for, and resumes it under the same attempt', async () => {
    const attempts: (string | null)[] = [];
    const lost: Publish = (_s, ledger) => {
      ledger.write({
        startedAt: 1,
        head: HEAD,
        reviewId: 'R',
        inFlight: 'submit',
        added: {},
        submitted: false,
      });
      return Promise.reject(new ReviewPublishError('unknown', 'no answer'));
    };
    await expect(
      submitReview(request(['summary', 'inline:k1']), src(lost))
    ).rejects.toThrow('no answer');
    expect(states()['inline:k1']).toBe('unknown');
    const first = readDraftFile(dir, REF, 'bea').submission!;

    const resumed: Publish = (_s, ledger: LedgerStore) => {
      attempts.push(ledger.read()?.inFlight ?? null);
      return Promise.resolve({ reviewId: 'R', items: { 'inline:k1': 'C1' } });
    };
    await submitReview(request(['summary', 'inline:k1']), src(resumed));
    expect(attempts).toEqual(['submit']);
    expect(states()['inline:k1']).toBe('published');
    const published = listReviewDrafts(
      { ref: REF, viewer: 'bea' },
      src()
    ).drafts.find((d) => d.id === 'inline:k1')!.publication;
    expect(published).toMatchObject({ attempt: first.attempt, remoteId: 'C1' });
  });

  it('leaves the drafts as they were when the pull request moved on', async () => {
    await expect(
      submitReview(
        request(['inline:k1']),
        src(() =>
          Promise.reject(new ReviewPublishError('moved', 'new commits'))
        )
      )
    ).rejects.toThrow('new commits');
    expect(states()['inline:k1']).toBe('unpublished');
  });

  it('gives a refused review’s reason, and the drafts can be edited again', async () => {
    await expect(
      submitReview(
        request(['inline:k1']),
        src(() => Promise.reject(new ReviewPublishError('refused', 'locked')))
      )
    ).rejects.toThrow('locked');
    const d = listReviewDrafts({ ref: REF, viewer: 'bea' }, src()).drafts.find(
      (x) => x.id === 'inline:k1'
    )!;
    expect(d.publication).toMatchObject({ state: 'failed', reason: 'locked' });
    write(inline('k1'), 'Edited.');
  });

  it('puts back a draft an earlier attempt chose and this one does not', async () => {
    await submitReview(
      request(['inline:k1', 'inline:k2']),
      src(() => Promise.reject(new ReviewPublishError('refused', 'no')))
    ).catch(() => undefined);
    await submitReview(
      request(['inline:k1']),
      src(() =>
        Promise.resolve({ reviewId: 'R', items: { 'inline:k1': 'C1' } })
      )
    );
    expect(states()).toMatchObject({
      'inline:k1': 'published',
      'inline:k2': 'unpublished',
    });
  });

  it('refuses what is no review: a conversation comment, or nothing to say', async () => {
    const never = src(() => Promise.reject(new Error('should not publish')));
    await expect(submitReview(request(['general']), never)).rejects.toThrow(
      'posted on its own'
    );
    await expect(
      submitReview(request([], 'REQUEST_CHANGES' as never), never)
    ).rejects.toThrow('Say what needs to change');
  });

  it('refuses another account’s submit before touching anything', async () => {
    await expect(
      submitReview({ ...request(['inline:k1']), viewer: 'carol' }, src())
    ).rejects.toBeInstanceOf(PullRequestIdentityError);
    expect(states()['inline:k1']).toBe('unpublished');
  });
});

describe('parseSubmitReviewRequest', () => {
  it('refuses a short head, an unknown event and non-string ids', () => {
    expect(() =>
      parseSubmitReviewRequest({ ...request([]), head: 'abc' })
    ).toThrow('head');
    expect(() =>
      parseSubmitReviewRequest({ ...request([]), event: 'MERGE' })
    ).toThrow('event');
    expect(() =>
      parseSubmitReviewRequest({ ...request([]), draftIds: [1] })
    ).toThrow('ids');
  });
});
