import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ReviewPublishError,
  type LedgerStore,
  type PullRequestRef,
  type ReviewEvent,
  type ReviewSubmission,
} from '@n10/vcs-core';
import { PullRequestIdentityError } from './pr-snapshot.js';
import { readDraftFile, writeDraftFile } from './review-draft-store.js';
import { listReviewDrafts, saveReviewDraft } from './review-drafts.js';
import {
  DraftsOnOtherCommitError,
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
    head: HEAD,
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

const request = (draftIds: string[], event: ReviewEvent = 'APPROVE') => ({
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
          head: HEAD,
          reviewId: 'R',
          inFlight: null,
          sending: null,
          added: {},
          submitted: true,
        });
        return Promise.resolve({
          reviewId: 'R',
          items: { 'inline:k1': 'C1', 'inline:k2': 'C2', 'reply:PRRT_1': 'C3' },
          resumed: null,
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
        head: HEAD,
        reviewId: 'R',
        inFlight: 'submit',
        sending: null,
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
      return Promise.resolve({
        reviewId: 'R',
        items: { 'inline:k1': 'C1' },
        resumed: { state: 'APPROVED', body: 'Looks right.' },
      });
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
        Promise.resolve({
          reviewId: 'R',
          items: { 'inline:k1': 'C1' },
          resumed: null,
        })
      )
    );
    expect(states()).toMatchObject({
      'inline:k1': 'published',
      'inline:k2': 'unpublished',
    });
  });

  it('sends the request as asked, and settles a review found filed by what it holds', async () => {
    const unanswered = src((_s, ledger) => {
      ledger.write({
        head: HEAD,
        reviewId: 'R',
        inFlight: 'submit',
        sending: null,
        added: { 'inline:k1': { id: 'C1', body: 'x' } },
        submitted: false,
      });
      return Promise.reject(new ReviewPublishError('unknown', 'no answer'));
    });
    await submitReview(request(['summary', 'inline:k1']), unanswered).catch(
      () => undefined
    );
    let sent: ReviewSubmission | null = null;
    const answer = await submitReview(
      request(['inline:k1', 'inline:k2'], 'COMMENT'),
      src((submission) => {
        sent = submission;
        return Promise.resolve({
          reviewId: 'R',
          items: { 'inline:k1': 'C1' },
          resumed: { state: 'APPROVED', body: 'Looks right.' },
        });
      })
    );
    // What the provider is asked for is this request, never an old one.
    expect(sent).toMatchObject({ event: 'COMMENT', body: '' });
    expect(answer.resumed).toEqual({ state: 'APPROVED' });
    expect(states()).toMatchObject({
      // The filed review carries the summary's text.
      summary: 'published',
      'inline:k1': 'published',
      'inline:k2': 'unpublished',
    });
  });

  it('settles every item a filed review holds, even one a later attempt deselected', async () => {
    const lostSubmit = src((_s, ledger) => {
      ledger.write({
        head: HEAD,
        reviewId: 'R',
        inFlight: 'submit',
        sending: null,
        added: {
          'inline:k1': { id: 'C1', body: 'x' },
          'inline:k2': { id: 'C2', body: 'y' },
        },
        submitted: false,
      });
      return Promise.reject(new ReviewPublishError('unknown', 'no answer'));
    });
    await submitReview(request(['inline:k1', 'inline:k2']), lostSubmit).catch(
      () => undefined
    );
    await submitReview(
      request(['inline:k1']),
      src(() => Promise.reject(new Error('offline')))
    ).catch(() => undefined);
    await submitReview(
      request(['inline:k1']),
      src(() =>
        Promise.resolve({
          reviewId: 'R',
          items: { 'inline:k1': 'C1', 'inline:k2': 'C2' },
          resumed: { state: 'COMMENTED', body: '' },
        })
      )
    );
    expect(states()).toMatchObject({
      'inline:k1': 'published',
      'inline:k2': 'published',
    });
  });

  it('holds a deselected draft locked while an earlier step is unaccounted for', async () => {
    const lostSubmit = src((_s, ledger) => {
      ledger.write({
        head: HEAD,
        reviewId: 'R',
        inFlight: 'submit',
        sending: null,
        added: {
          'inline:k1': { id: 'C1', body: 'x' },
          'inline:k2': { id: 'C2', body: 'y' },
        },
        submitted: false,
      });
      return Promise.reject(new ReviewPublishError('unknown', 'no answer'));
    });
    await submitReview(request(['inline:k1', 'inline:k2']), lostSubmit).catch(
      () => undefined
    );
    await submitReview(
      request(['inline:k1']),
      src(() => Promise.reject(new Error('offline')))
    ).catch(() => undefined);
    // It may be on GitHub: not to be edited until that is known.
    expect(states()['inline:k2']).toBe('unknown');
    expect(() => write(inline('k2'), 'Edited.')).toThrow('may already');
    await submitReview(
      request(['inline:k1']),
      src(() =>
        Promise.resolve({
          reviewId: 'R',
          items: { 'inline:k1': 'C1' },
          resumed: null,
        })
      )
    );
    // The lost submit had not landed, and k2 was taken out before it.
    expect(states()).toMatchObject({
      'inline:k1': 'published',
      'inline:k2': 'unpublished',
    });
  });

  it('settles a review filed on GitHub by what it holds, and not the summary it does not carry', async () => {
    await submitReview(
      request(['summary', 'inline:k1', 'inline:k2']),
      src(() => Promise.reject(new ReviewPublishError('refused', 'no')))
    ).catch(() => undefined);
    const answer = await submitReview(
      request(['summary', 'inline:k1']),
      src(() =>
        Promise.resolve({
          reviewId: 'R',
          // k2 was in the pending review when it was filed on GitHub,
          // with the reviewer's own text.
          items: { 'inline:k1': 'C1', 'inline:k2': 'C2' },
          resumed: { state: 'COMMENTED', body: 'Filed from the web.' },
        })
      )
    );
    expect(answer.resumed).toEqual({ state: 'COMMENTED' });
    expect(states()).toMatchObject({
      summary: 'unpublished',
      'inline:k1': 'published',
      'inline:k2': 'published',
    });
  });

  it('gives a refusal’s reason to the draft it stopped at, and leaves the others as they were', async () => {
    await expect(
      submitReview(
        request(['inline:k1', 'reply:PRRT_1']),
        src(() =>
          Promise.reject(
            new ReviewPublishError('refused', 'thread is locked', {
              item: 'reply:PRRT_1',
            })
          )
        )
      )
    ).rejects.toThrow('locked');
    expect(states()).toMatchObject({
      'inline:k1': 'unpublished',
      'reply:PRRT_1': 'failed',
    });
  });

  it('reads a draft left being posted by a submit that stopped with n10 as maybe posted', async () => {
    let seen: string | undefined;
    await submitReview(
      request(['inline:k1']),
      src(() => {
        seen = states()['inline:k1'];
        return Promise.reject(new Error('killed'));
      })
    ).catch(() => undefined);
    expect(seen).toBe('publishing');
    const file = readDraftFile(dir, REF, 'bea');
    writeDraftFile(dir, {
      ...file,
      drafts: file.drafts.map((d) =>
        d.id === 'inline:k1'
          ? {
              ...d,
              publication: { state: 'publishing', attempt: 'A', since: 1 },
            }
          : d
      ),
    });
    expect(states()['inline:k1']).toBe('unknown');
  });

  it('refuses a comment written on another commit, before anything changes', async () => {
    const other = 'b'.repeat(40);
    saveReviewDraft(
      {
        ref: REF,
        viewer: 'bea',
        target: {
          ...inline('k3'),
          anchor: { ...inline('k3').anchor, head: other },
        },
        body: 'Is 250 ms enough?',
      },
      src()
    );
    saveReviewDraft(
      {
        ref: REF,
        viewer: 'bea',
        target: {
          ...inline('k4'),
          anchor: { ...inline('k4').anchor, head: null },
        },
        body: 'Written before n10 knew the commit.',
      },
      src()
    );
    let calls = 0;
    const count: Publish = () => {
      calls++;
      return Promise.reject(new Error('should not publish'));
    };
    const err = await submitReview(
      request(['inline:k1', 'inline:k3', 'inline:k4']),
      src(count)
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftsOnOtherCommitError);
    expect((err as DraftsOnOtherCommitError).draftIds).toEqual([
      'inline:k3',
      'inline:k4',
    ]);
    expect(calls).toBe(0);
    expect(states()).toMatchObject({
      'inline:k1': 'unpublished',
      'inline:k3': 'unpublished',
    });
    expect(readDraftFile(dir, REF, 'bea').submission).toBeUndefined();
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

describe('two submits at once', () => {
  it('refuses the second while the first is going, and files once', async () => {
    let calls = 0;
    let finish: () => void = () => undefined;
    const slow: Publish = () => {
      calls++;
      return new Promise((resolve) => {
        finish = () =>
          resolve({
            reviewId: 'R',
            items: { 'inline:k1': 'C1' },
            resumed: null,
          });
      });
    };
    const first = submitReview(request(['inline:k1']), src(slow));
    await expect(
      submitReview(request(['inline:k1']), src(slow))
    ).rejects.toThrow('already being submitted');
    finish();
    await first;
    expect(calls).toBe(1);
    expect(states()['inline:k1']).toBe('published');
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
