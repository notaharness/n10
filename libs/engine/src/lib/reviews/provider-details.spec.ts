import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestChecks, PullRequestDetail } from '@n10/vcs-core';

import { reviewReadFixture } from './review-read-fixture.js';
import { readResourceValue } from './read-resource.js';

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 42,
};

const env = vi.hoisted(() => ({
  configured: true,
  /** The repository's config as it reads now. */
  project: {
    owner: 'acme',
    repo: 'app',
    username: 'bob' as string | undefined,
  },
  /** Whether /repo is still the open repository. */
  open: true,
  detail: undefined as
    | ((auth: unknown, project: unknown, prId: number) => Promise<unknown>)
    | undefined,
  checks: undefined as
    | ((auth: unknown, project: unknown, prId: number) => Promise<unknown>)
    | undefined,
  lookups: [] as [string, number][],
  onLookup: (() => undefined) as () => void,
}));

const { service } = reviewReadFixture(
  () => ({
    repository: env.configured
      ? {
          provider: 'github',
          host: 'github.com',
          repository: `acme/${env.project.repo}`,
        }
      : null,
    viewer: env.project.username ?? null,
    vcsConfigured: env.configured,
    config: {
      vendor: 'github',
      vendorAuth: { token: 't' },
      vendorProject: { owner: 'acme', repo: env.project.repo },
    },
    provider: {
      id: 'github',
      fetchPullRequestDetail: env.detail,
      fetchPullRequestChecks: env.checks,
    },
  }),
  () => env.open,
  (cwd, id) => {
    env.lookups.push([cwd, id]);
    env.onLookup();
    return Promise.resolve({ kind: 'gone' });
  }
);
async function getPullRequestSnapshot(request: unknown) {
  return readResourceValue(service.snapshot(request));
}
async function getPullRequestChecks(request: unknown) {
  return readResourceValue(service.checks(request));
}

beforeEach(() => {
  service.reset();
  env.configured = true;
  env.open = true;
  env.onLookup = () => undefined;
  env.project = { owner: 'acme', repo: 'app', username: 'bob' };
  env.detail = undefined;
  env.checks = undefined;
  env.lookups = [];
});

describe('getPullRequestSnapshot', () => {
  it.each([
    ['nothing', undefined],
    ['a bare number', 42],
    ['a ref without a repository', { ref: { ...REF, repository: undefined } }],
    ['a fractional number', { ref: { ...REF, number: 4.5 } }],
  ])('rejects %s before reading anything', async (_label, request) => {
    await expect(getPullRequestSnapshot(request)).rejects.toThrow(TypeError);
    expect(env.lookups).toEqual([]);
  });

  it("refuses another repository's pull request", async () => {
    await expect(
      getPullRequestSnapshot({ ref: { ...REF, repository: 'acme/other' } })
    ).rejects.toThrow('is not in github.com/acme/app');
    expect(env.lookups).toEqual([]);
  });

  it('refuses a caller that last saw another account', async () => {
    await expect(
      getPullRequestSnapshot({ ref: REF, viewer: 'alice' })
    ).rejects.toThrow('The account changed from alice to bob');
  });

  it('refuses to answer once another repository was opened during the read', async () => {
    env.onLookup = () => {
      env.open = false;
    };
    await expect(getPullRequestSnapshot({ ref: REF })).rejects.toThrow(
      'This repository is no longer open'
    );
  });

  it('refuses to answer once the config names another repository during the read', async () => {
    env.onLookup = () => {
      env.project = { ...env.project, repo: 'lib' };
    };
    await expect(getPullRequestSnapshot({ ref: REF })).rejects.toThrow(
      'is not in github.com/acme/lib'
    );
  });

  it('refuses to answer once the config names another account during the read', async () => {
    env.onLookup = () => {
      env.project = { ...env.project, username: 'carol' };
    };
    await expect(getPullRequestSnapshot({ ref: REF })).rejects.toThrow(
      'The account changed from bob to carol'
    );
  });

  it('refuses when the provider is not configured', async () => {
    env.configured = false;
    await expect(getPullRequestSnapshot({ ref: REF })).rejects.toThrow(
      'No pull request provider is configured'
    );
  });

  it('answers from the shared list cache, echoing the ref and the account', async () => {
    const snap = await getPullRequestSnapshot({ ref: REF });
    expect(env.lookups).toEqual([['/repo', 42]]);
    expect(snap).toMatchObject({
      ref: REF,
      viewer: 'bob',
      summary: { kind: 'gone' },
      detail: { state: 'unsupported' },
    });
  });

  it("reads the provider's detail with the repository's own config", async () => {
    const seen: unknown[] = [];
    env.detail = (auth, project, prId) => {
      seen.push([auth, project, prId]);
      return Promise.resolve({
        ref: REF,
        source: { branch: 'undo', repository: null, head: 'a'.repeat(40) },
        target: { branch: 'main', head: 'b'.repeat(40) },
      } as PullRequestDetail);
    };
    const snap = await getPullRequestSnapshot({ ref: REF });
    expect(seen).toEqual([
      [{ token: 't' }, { owner: 'acme', repo: 'app' }, 42],
    ]);
    expect(snap.detail).toMatchObject({ state: 'read' });
    expect(snap.head).toEqual({ oid: 'a'.repeat(40), from: 'detail' });
    expect(snap.target).toBe('b'.repeat(40));
  });
});

describe('getPullRequestChecks', () => {
  it('rejects an untrusted request before reading anything', async () => {
    await expect(getPullRequestChecks(42)).rejects.toThrow(TypeError);
    expect(env.lookups).toEqual([]);
  });

  it('refuses to answer once another repository was opened during the read', async () => {
    env.onLookup = () => {
      env.open = false;
    };
    await expect(getPullRequestChecks({ ref: REF })).rejects.toThrow(
      'This repository is no longer open'
    );
  });

  it("reads the provider's checks with the repository's own config", async () => {
    const seen: unknown[] = [];
    env.checks = (auth, project, prId) => {
      seen.push([auth, project, prId]);
      return Promise.resolve({
        ref: REF,
        head: 'a'.repeat(40),
        checks: {
          state: 'read',
          value: { items: [], total: 0, complete: true },
        },
        rules: { state: 'unsupported', reason: 'no rules' },
        merge: {
          lifecycle: { state: 'open', isDraft: false, native: 'OPEN' },
          conflicts: 'none',
          behind: false,
          blocked: false,
          reviews: 'not-required',
          conversations: null,
          native: 'CLEAN',
        },
      } as PullRequestChecks);
    };
    const res = await getPullRequestChecks({ ref: REF });
    expect(seen).toEqual([
      [{ token: 't' }, { owner: 'acme', repo: 'app' }, 42],
    ]);
    expect(res).toMatchObject({ viewer: 'bob', checks: { state: 'read' } });
  });
});
