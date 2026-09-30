import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  PullRequestRef,
  PullRequestRevisions,
  RepositoryRef,
} from '@n10/vcs-core';
import {
  parseHistoryRequest,
  parseVisitRequest,
  readPullRequestHistory,
} from './pr-history.js';
import { prStorePath } from './pr-store-file.js';
import { VisitBaselines } from './review-checkpoints.js';

const REPO: RepositoryRef = {
  provider: 'github',
  host: 'github.com',
  repository: 'n10/fixture',
};
const REF: PullRequestRef = { ...REPO, number: 42 };
const oid = (c: string) => c.repeat(40);

const revisions = (
  ref: PullRequestRef,
  viewer: string | null = 'Octocat'
): PullRequestRevisions => ({
  ref,
  events: [{ kind: 'commit', head: oid('1'), at: null }],
  complete: true,
  viewer,
  lastReview: { head: oid('1'), at: '2026-01-01T00:00:00Z' },
  reviewsComplete: true,
});
const REQ = { ref: REF, visitId: 'v1' };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-history-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function sources(
  over: Partial<Parameters<typeof readPullRequestHistory>[1]> = {}
) {
  return {
    repository: () => REPO,
    viewer: () => 'octocat',
    revisions: async () => revisions(REF),
    baselines: new VisitBaselines(dir),
    ...over,
  };
}

describe('readPullRequestHistory', () => {
  it('answers with the provider’s record and the last visit, as whom it was read', async () => {
    const history = await readPullRequestHistory(REQ, sources());
    expect(history).toMatchObject({
      ref: REF,
      viewer: 'octocat',
      revisions: { state: 'read', value: revisions(REF) },
      lastReview: {
        state: 'read',
        value: { head: oid('1'), at: '2026-01-01T00:00:00Z' },
      },
      lastVisit: { state: 'read', value: null },
    });
  });

  it('echoes the repository id the provider named, not the caller’s', async () => {
    const named = { ...REF, id: 'R_real' };
    const history = await readPullRequestHistory(
      REQ,
      sources({ revisions: async () => revisions(named) })
    );
    expect(history.ref).toEqual(named);
  });

  it('does not offer another account’s review as the viewer’s', async () => {
    const history = await readPullRequestHistory(
      REQ,
      sources({ revisions: async () => revisions(REF, 'hubot') })
    );
    expect(history.lastReview).toMatchObject({
      state: 'failed',
      reason: 'The provider answered as hubot, not octocat',
    });
    expect(history.revisions.state).toBe('read');
  });

  it('says a provider without history has none, rather than an empty one', async () => {
    const history = await readPullRequestHistory(
      REQ,
      sources({ revisions: undefined })
    );
    expect(history.revisions.state).toBe('unsupported');
  });

  it('never lets another pull request’s history answer for this one', async () => {
    const history = await readPullRequestHistory(
      REQ,
      sources({ revisions: async () => revisions({ ...REF, number: 7 }) })
    );
    expect(history.revisions).toMatchObject({
      state: 'failed',
      reason: 'The provider answered about github.com/n10/fixture#7',
    });
  });

  it('refuses an answer when the account changed during the read', async () => {
    let viewer = 'octocat';
    const read = readPullRequestHistory(
      REQ,
      sources({
        viewer: () => viewer,
        revisions: async () => {
          viewer = 'hubot';
          return revisions(REF);
        },
      })
    );
    await expect(read).rejects.toThrow(
      'The account changed from octocat to hubot'
    );
  });

  it('does not call a last review past the reviews read "none"', async () => {
    const history = await readPullRequestHistory(
      REQ,
      sources({
        revisions: async () => ({
          ...revisions(REF),
          lastReview: null,
          reviewsComplete: false,
        }),
      })
    );
    expect(history.lastReview).toMatchObject({ state: 'failed' });
  });

  it('offers a last review found on a page that does not reach the first', async () => {
    const history = await readPullRequestHistory(
      REQ,
      sources({
        revisions: async () => ({ ...revisions(REF), reviewsComplete: false }),
      })
    );
    expect(history.lastReview).toEqual({
      state: 'read',
      value: { head: oid('1'), at: '2026-01-01T00:00:00Z' },
    });
  });

  it('does not guess the revision of a last review the provider left out', async () => {
    const history = await readPullRequestHistory(
      REQ,
      sources({
        revisions: async () => ({
          ...revisions(REF),
          lastReview: { head: null, at: '2026-01-02T00:00:00Z' },
        }),
      })
    );
    expect(history.lastReview).toMatchObject({
      state: 'failed',
      reason: expect.stringContaining('did not say which revision'),
    });
  });

  it('reports a checkpoint file it cannot read as a failed read', async () => {
    writeFileSync(prStorePath(dir, REF, 'octocat'), '{ not json');
    const history = await readPullRequestHistory(REQ, sources());
    expect(history.lastVisit.state).toBe('failed');
  });
});

describe('parsing requests', () => {
  const visit = { head: oid('a'), target: oid('b'), mergeBase: oid('c') };

  it('takes a visit that names its commits and the visit it belongs to', () => {
    expect(
      parseVisitRequest({ ...REQ, viewer: 'octocat', visit, reviewed: null })
    ).toEqual({ ...REQ, viewer: 'octocat', visit, reviewed: null });
  });

  it('refuses one that does not name its commits', () => {
    expect(() =>
      parseVisitRequest({ ...REQ, visit: { head: 'main' } })
    ).toThrow('A visit names its commits');
  });

  it('refuses a history read with no visit to freeze its baseline to', () => {
    expect(() => parseHistoryRequest({ ref: REF })).toThrow(
      'A history read names its visit'
    );
  });
});
