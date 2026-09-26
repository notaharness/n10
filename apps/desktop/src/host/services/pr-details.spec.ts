import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestDetail } from '@n10/vcs-core';

/**
 * The snapshot bridge's own jobs: parse what the renderer sends as
 * untrusted, and answer only for the repository and account that are
 * open. Core's sequence is exercised for real; the provider, the list
 * cache and the open repository are this file's stand-ins.
 */

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 42,
};

const env = vi.hoisted(() => ({
  configured: true,
  viewer: 'bob' as string | null,
  detail: undefined as
    | ((auth: unknown, project: unknown, prId: number) => Promise<unknown>)
    | undefined,
  lookups: [] as [string, number][],
}));

vi.mock('./repo.js', () => ({ requireRepo: () => '/repo' }));
vi.mock('./reviews.js', () => ({
  getReviewViewer: () => (env.viewer ? { identifier: env.viewer } : null),
}));
vi.mock('./pull-requests.js', () => ({
  lookupPullRequest: (cwd: string, prId: number) => {
    env.lookups.push([cwd, prId]);
    return Promise.resolve({ kind: 'gone' });
  },
  resolveProvider: () => ({
    config: {
      vendor: 'github',
      vendorAuth: { token: 't' },
      vendorProject: { owner: 'acme', repo: 'app' },
    },
    configured: env.configured,
    provider: {
      id: 'github',
      repositoryRef: (p: Record<string, string>) => ({
        provider: 'github',
        host: 'github.com',
        repository: `${p.owner}/${p.repo}`,
      }),
      fetchPullRequestDetail: env.detail,
    },
  }),
}));

const { getPullRequestSnapshot } = await import('./pr-details.js');

beforeEach(() => {
  env.configured = true;
  env.viewer = 'bob';
  env.detail = undefined;
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
    ).rejects.toThrow('Signed in as bob now, not alice');
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
        source: {
          branch: 'undo',
          repository: 'acme/app',
          head: 'a'.repeat(40),
        },
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
