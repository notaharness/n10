import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The mention bridge's own jobs: parse what the renderer sends as
 * untrusted, search through the configured provider with its
 * credentials, and answer only for the repository that is open.
 */

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 42,
};
const ALICE = { token: '@alice', displayName: 'Alice', handle: 'alice' };

const env = vi.hoisted(() => ({
  open: true,
  asked: [] as unknown[][],
}));

vi.mock('@n10/vcs-core', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readConfig: () => ({
    vendor: 'github',
    vendorProject: { owner: 'acme', repo: 'app', username: 'bob' },
  }),
}));
vi.mock('./repo.js', () => ({
  requireRepo: () => '/repo',
  activeRepoIs: (cwd: string) => env.open && cwd === '/repo',
  configuredRepository: () => ({
    provider: 'github',
    host: 'github.com',
    repository: 'acme/app',
  }),
}));
vi.mock('./pull-requests.js', () => ({
  resolveProvider: () => ({
    config: {
      vendor: 'github',
      vendorAuth: { token: 't' },
      vendorProject: { owner: 'acme', repo: 'app' },
    },
    configured: true,
    provider: {
      id: 'github',
      searchMentionCandidates: (...args: unknown[]) => {
        env.asked.push(args);
        return Promise.resolve([ALICE]);
      },
    },
  }),
}));

const { searchMentionCandidates } = await import('./mentions.js');

beforeEach(() => {
  env.open = true;
  env.asked = [];
});

describe('searchMentionCandidates', () => {
  it('searches the provider with its credentials for the query', async () => {
    const found = await searchMentionCandidates({ ref: REF, query: 'al' });
    expect(found).toEqual({
      ref: REF,
      viewer: 'bob',
      query: 'al',
      candidates: [ALICE],
    });
    expect(env.asked).toEqual([
      [{ token: 't' }, { owner: 'acme', repo: 'app' }, 'al'],
    ]);
  });

  it('rejects a request without a query before asking anyone', async () => {
    await expect(searchMentionCandidates({ ref: REF })).rejects.toThrow(
      TypeError
    );
    expect(env.asked).toEqual([]);
  });

  it('refuses a repository that is no longer open', async () => {
    env.open = false;
    await expect(
      searchMentionCandidates({ ref: REF, query: 'al' })
    ).rejects.toThrow(/no longer the repository open/);
    expect(env.asked).toEqual([]);
  });
});
