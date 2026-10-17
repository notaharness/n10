import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisitBaselines } from '@n10/core';
import type { WorktreeService } from '../worktrees/api.js';
import { createHistoryReads } from './history-reads.js';
import { readResourceValue } from './read-resource.js';
import { reviewReadFixture } from './review-read-fixture.js';
import { createReviewService } from './review-service.js';

/**
 * History reads' own jobs: parse what the caller sends as untrusted,
 * hand the provider the repository's credentials, and keep an answer
 * only while it is good and its scope holds. Core's sequences run for
 * real; the provider and the open repository are stand-ins.
 */

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 42,
};
const env = {
  revisions: [] as [unknown, unknown, number][],
  token: 't',
  fail: false,
};
const dir = mkdtempSync(join(tmpdir(), 'n10-history-reads-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fixture = reviewReadFixture(() => ({
  repository: {
    provider: 'github',
    host: 'github.com',
    repository: 'acme/app',
  },
  viewer: 'bob',
  vcsConfigured: true,
  config: {
    vendor: 'github',
    vendorAuth: { token: env.token },
    vendorProject: { owner: 'acme', repo: 'app' },
  },
  provider: {
    id: 'github',
    fetchPullRequestRevisions(auth: unknown, project: unknown, n: number) {
      env.revisions.push([auth, project, n]);
      if (env.fail) return Promise.reject(new Error('GitHub is down'));
      return Promise.resolve({
        ref: REF,
        events: [],
        complete: true,
        viewer: 'bob',
        lastReview: null,
        reviewsComplete: true,
      });
    },
  },
}));
const { options } = fixture;
const reads = createHistoryReads({
  ...options,
  baselines: new VisitBaselines(dir),
});

beforeEach(() => {
  env.revisions = [];
  env.token = 't';
  env.fail = false;
  reads.reset();
});

const REQ = { ref: REF, visitId: 'v1' };

describe('history', () => {
  it('reads the provider with the repository’s credentials, once per visit', async () => {
    const req = { ref: REF, visitId: 'v1' };
    const history = await readResourceValue(reads.history(req));
    await readResourceValue(reads.history(req));
    expect(env.revisions).toEqual([
      [{ token: 't' }, { owner: 'acme', repo: 'app' }, 42],
    ]);
    expect(history).toMatchObject({
      viewer: 'bob',
      revisions: { state: 'read' },
      lastVisit: { state: 'read', value: null },
    });
  });

  it("refuses another repository's pull request before reading", () => {
    expect(() =>
      reads.history({
        ref: { ...REF, repository: 'acme/other' },
        visitId: 'v1',
      })
    ).toThrow('is not in github.com/acme/app');
    expect(env.revisions).toEqual([]);
  });

  it('refuses a request that names no visit', () => {
    expect(() => reads.history({ ref: REF })).toThrow('names its visit');
  });

  it('reads a failed provider read again rather than keeping it', async () => {
    env.fail = true;
    expect(await readResourceValue(reads.history(REQ))).toMatchObject({
      revisions: { state: 'failed' },
    });
    env.fail = false;
    expect(await readResourceValue(reads.history(REQ))).toMatchObject({
      revisions: { state: 'read' },
    });
    expect(env.revisions).toHaveLength(2);
  });

  it('reads a last visit that could not be read again rather than keeping it', async () => {
    const lastVisit = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('EACCES: the checkpoints file');
      })
      .mockReturnValue(null);
    const flaky = createHistoryReads({
      ...options,
      baselines: { lastVisit } as unknown as VisitBaselines,
    });
    expect(await readResourceValue(flaky.history(REQ))).toMatchObject({
      lastVisit: { state: 'failed' },
    });
    expect(await readResourceValue(flaky.history(REQ))).toMatchObject({
      lastVisit: { state: 'read', value: null },
    });
  });
});

describe('history in the review service', () => {
  const service = () =>
    createReviewService({
      ...options,
      worktrees: {} as WorktreeService,
      baselines: new VisitBaselines(dir),
    });

  it('reads again when the pull request rows change', async () => {
    const reviews = service();
    await readResourceValue(reviews.history(REQ));
    fixture.listChanged({ feature: { id: 42 } as never });
    await readResourceValue(reviews.history(REQ));
    expect(env.revisions).toHaveLength(2);
  });

  it('forgets what one set of credentials was told when they change', async () => {
    const reviews = service();
    await readResourceValue(reviews.history(REQ));
    env.token = 't2';
    fixture.changed();
    await readResourceValue(reviews.history(REQ));
    expect(env.revisions.map(([auth]) => auth)).toEqual([
      { token: 't' },
      { token: 't2' },
    ]);
  });
});
