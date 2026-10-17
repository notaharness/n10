import { describe, expect, it } from 'vitest';
import type { PullRequestHistory } from '../../../host/contract.js';
import {
  anchoredSides,
  historyFailed,
  pairOf,
  revisionEntries,
  sinceOptions,
  totalOf,
  type HistoryRead,
} from './revision-model.js';

/**
 * Which changes a choice shows: a "since" reads from the revision the
 * history names, and without one says why rather than showing every
 * change under its name.
 */

const oid = (c: string) => c.repeat(40);
const HEAD = oid('f');

function history(patch: Partial<PullRequestHistory> = {}): HistoryRead {
  return {
    state: 'read',
    value: {
      ref: {
        provider: 'github',
        host: 'github.com',
        repository: 'o/r',
        number: 1,
      },
      viewer: 'me',
      revisions: {
        state: 'read',
        value: {
          ref: {
            provider: 'github',
            host: 'github.com',
            repository: 'o/r',
            number: 1,
          },
          events: [
            { kind: 'commit', head: oid('1'), at: '2026-01-01T00:00:00Z' },
            {
              kind: 'force-push',
              before: oid('1'),
              head: oid('2'),
              at: '2026-01-02T00:00:00Z',
            },
          ],
          complete: true,
          viewer: 'me',
          lastReview: null,
          reviewsComplete: true,
        },
      },
      lastReview: { state: 'read', value: null },
      lastVisit: { state: 'read', value: null },
      ...patch,
    },
  };
}

describe('the "since" options', () => {
  it('names the revision each starts at', () => {
    const [visit, review] = sinceOptions(
      history({
        lastVisit: {
          state: 'read',
          value: {
            head: oid('1'),
            target: oid('0'),
            mergeBase: oid('0'),
            at: 1,
          },
        },
        lastReview: { state: 'read', value: { head: oid('2'), at: null } },
      })
    );
    expect(visit).toMatchObject({ from: oid('1'), pending: false });
    expect(review).toMatchObject({ from: oid('2'), detail: '2222222' });
  });

  it('says why one has no revision', () => {
    const [visit, review] = sinceOptions(history());
    expect(visit).toMatchObject({
      from: null,
      detail: 'This is your first visit',
    });
    expect(review).toMatchObject({
      from: null,
      detail: 'You haven’t submitted a review',
    });
    const [, failed] = sinceOptions(
      history({
        lastReview: { state: 'failed', kind: 'network', reason: 'offline' },
      })
    );
    expect(failed?.detail).toBe('Couldn’t read it: offline');
  });

  it('waits for the history, and says when it could not be read', () => {
    expect(sinceOptions({ state: 'loading' })[0]?.pending).toBe(true);
    expect(
      sinceOptions({ state: 'failed', reason: 'offline' })[1]?.detail
    ).toBe('Couldn’t read the history: offline');
  });
});

describe('what a choice reads', () => {
  const options = sinceOptions(
    history({
      lastReview: { state: 'read', value: { head: oid('2'), at: null } },
    })
  );

  it('reads all changes, or the revision it names to the head on screen', () => {
    expect(pairOf({ mode: 'all' }, options, HEAD)).toBeNull();
    expect(pairOf({ mode: 'since-review' }, options, HEAD)).toEqual({
      from: oid('2'),
      to: HEAD,
    });
    expect(
      pairOf({ mode: 'range', from: oid('1'), to: oid('2') }, options, HEAD)
    ).toEqual({ from: oid('1'), to: oid('2') });
  });

  it('never shows every change under a "since" without its revision', () => {
    expect(pairOf({ mode: 'since-visit' }, options, HEAD)).toEqual({
      unavailable: 'This is your first visit',
    });
  });

  it('waits while the history is read', () => {
    expect(
      pairOf({ mode: 'since-visit' }, sinceOptions({ state: 'loading' }), HEAD)
    ).toBe('pending');
  });
});

describe('the revisions a range can use', () => {
  it('lists each once, newest first, with what it was', () => {
    const read = history({
      lastReview: {
        state: 'read',
        value: { head: oid('1'), at: '2026-01-03T00:00:00Z' },
      },
    });
    const entries = revisionEntries(
      read.state === 'read' ? read.value : null,
      HEAD
    );
    expect(entries.map((e) => [e.oid, e.labels])).toEqual([
      [HEAD, ['On screen']],
      [oid('2'), ['Force-pushed']],
      [oid('1'), ['Commit', 'Replaced', 'Your last review']],
    ]);
  });

  it('lists the head a force-push replaced, though nothing else names it', () => {
    const read = history();
    if (read.state !== 'read' || read.value.revisions.state !== 'read') {
      throw new Error('fixture');
    }
    const revisions = read.value.revisions.value;
    const events = [
      {
        kind: 'force-push' as const,
        before: oid('9'),
        head: oid('2'),
        at: '2026-01-02T00:00:00Z',
      },
    ];
    const entries = revisionEntries(
      {
        ...read.value,
        revisions: { state: 'read', value: { ...revisions, events } },
      },
      HEAD
    );
    expect(entries.map((e) => [e.oid, e.labels])).toEqual([
      [HEAD, ['On screen']],
      [oid('2'), ['Force-pushed']],
      [oid('9'), ['Replaced']],
    ]);
  });
});

describe('the count a range’s files are out of', () => {
  const files = (...paths: string[]) => paths.map((path) => ({ path }));
  const all = { complete: true, files: files('a.ts', 'b.ts', 'c.ts') };

  it('is the pull request’s files when the range’s are among them', () => {
    expect(totalOf(all, { files: files('b.ts') })).toBe(3);
  });

  it('is absent when the range lists a file the pull request does not change', () => {
    expect(totalOf(all, { files: files('b.ts', 'README.md') })).toBeNull();
  });

  it('is absent when the pull request’s files were not all listed', () => {
    expect(
      totalOf({ ...all, complete: false }, { files: files('b.ts') })
    ).toBeNull();
  });
});

describe('the sides comments sit on', () => {
  const comparison = { mergeBaseOid: oid('b'), headOid: HEAD };

  it('is both for all changes', () => {
    expect(anchoredSides(null, comparison)).toEqual({
      LEFT: true,
      RIGHT: true,
    });
  });

  it('is the new side for a "since", which ends at the head', () => {
    expect(anchoredSides({ from: oid('1'), to: HEAD }, comparison)).toEqual({
      LEFT: false,
      RIGHT: true,
    });
  });

  it('is neither between two earlier revisions', () => {
    expect(anchoredSides({ from: oid('1'), to: oid('2') }, comparison)).toEqual(
      { LEFT: false, RIGHT: false }
    );
  });
});

describe('whether the history is worth reading again', () => {
  it('is when all of it, or any part, could not be read', () => {
    expect(historyFailed({ state: 'failed', reason: 'offline' })).toBe(true);
    expect(
      historyFailed(
        history({
          revisions: {
            state: 'failed',
            kind: 'server',
            reason: 'GitHub said 502',
          },
        })
      )
    ).toBe(true);
  });

  it('is not while it reads, or once all of it has', () => {
    expect(historyFailed({ state: 'loading' })).toBe(false);
    expect(historyFailed(history())).toBe(false);
  });
});
