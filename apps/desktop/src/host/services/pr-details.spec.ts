import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestChecks, PullRequestDetail } from '@n10/vcs-core';

/**
 * The snapshot and checks bridges' own jobs: parse what the renderer
 * sends as untrusted, and answer only for the repository and account
 * that are open. Core's sequences are exercised for real; the provider,
 * the list cache and the open repository are this file's stand-ins.
 */

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

vi.mock('@n10/vcs-core', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readConfig: () => ({ vendor: 'github', vendorProject: { ...env.project } }),
}));
// Both answer from the config they are handed, so a closure that read
// config once would miss every change below.
vi.mock('./repo.js', () => ({
  requireRepo: () => '/repo',
  activeRepoIs: (cwd: string) => env.open && cwd === '/repo',
  configuredRepository: (config: {
    vendorProject: { owner: string; repo: string };
  }) =>
    env.configured
      ? {
          provider: 'github',
          host: 'github.com',
          repository: `${config.vendorProject.owner}/${config.vendorProject.repo}`,
        }
      : null,
}));
vi.mock('./pull-requests.js', () => ({
  lookupPullRequest: (cwd: string, prId: number) => {
    env.lookups.push([cwd, prId]);
    env.onLookup();
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
      fetchPullRequestDetail: env.detail,
      fetchPullRequestChecks: env.checks,
    },
  }),
}));

const { getPullRequestSnapshot } = await import('./pr-details.js');
const { getPullRequestChecks } = await import('./pr-checks.js');

beforeEach(() => {
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
    ).rejects.toThrow('n10 acts as bob now, not alice');
  });

  it('refuses to answer once another repository was opened during the read', async () => {
    env.onLookup = () => {
      env.open = false;
    };
    await expect(getPullRequestSnapshot({ ref: REF })).rejects.toThrow(
      '/repo is no longer the repository open in n10'
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
      'n10 acts as carol now, not bob'
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
      '/repo is no longer the repository open in n10'
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
