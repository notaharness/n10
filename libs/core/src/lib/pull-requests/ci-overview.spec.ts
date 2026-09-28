import { describe, expect, it, vi } from 'vitest';
import type {
  AppConfig,
  CiOverview,
  PullRequestInfo,
  VcsProvider,
} from '@n10/vcs-core';
import { readCiLog, readCiOverview, type CiReadDeps } from './ci-overview.js';
import type { PullRequestLookup } from './pull-request-cache.js';

const CONFIG = {
  vendor: 'github',
  vendorAuth: {},
  vendorProject: { owner: 'o', repo: 'r' },
} as AppConfig;

const PR = { id: 7, headSha: 'abc123' } as PullRequestInfo;
const EMPTY: CiOverview = { provider: 'github', pipelines: [] };

function provider(overrides: Partial<VcsProvider> = {}): VcsProvider {
  return {
    id: 'github',
    displayName: 'GitHub',
    fetchCiOverview: vi.fn().mockResolvedValue(EMPTY),
    fetchCiLog: vi.fn().mockResolvedValue({ text: '' }),
    ...overrides,
  } as unknown as VcsProvider;
}

function deps(
  p: VcsProvider | null,
  lookup: PullRequestLookup = { kind: 'found', pr: PR },
  configured = true
): CiReadDeps {
  return {
    resolveProvider: () => ({ config: CONFIG, provider: p, configured }),
    lookupPullRequest: () => Promise.resolve(lookup),
  };
}

describe('readCiOverview', () => {
  it('asks the provider with the head commit the cached list names', async () => {
    const p = provider();
    await readCiOverview('/repo', 7, deps(p));
    expect(p.fetchCiOverview).toHaveBeenCalledWith({}, CONFIG.vendorProject, {
      id: 7,
      headSha: 'abc123',
    });
  });

  it('refuses without a configured provider', async () => {
    await expect(readCiOverview('/repo', 7, deps(null))).rejects.toThrow(
      'No pull request provider is configured'
    );
    await expect(
      readCiOverview('/repo', 7, deps(provider(), undefined, false))
    ).rejects.toThrow('No pull request provider is configured');
  });

  it('says a provider without CI support has none', async () => {
    const p = provider({ fetchCiOverview: undefined });
    await expect(readCiOverview('/repo', 7, deps(p))).rejects.toThrow(
      'n10 does not read CI from GitHub yet'
    );
  });

  it('tells a closed pull request from one it could not look up', async () => {
    await expect(
      readCiOverview('/repo', 7, deps(provider(), { kind: 'gone' }))
    ).rejects.toThrow('no longer open');
    await expect(
      readCiOverview(
        '/repo',
        7,
        deps(provider(), { kind: 'unknown', reason: 'GitHub is down' })
      )
    ).rejects.toThrow('GitHub is down');
  });
});

describe('readCiLog', () => {
  it('reads the tail through the provider the reference names', async () => {
    const p = provider();
    await readCiLog('/repo', { provider: 'github', jobId: 3 }, deps(p));
    expect(p.fetchCiLog).toHaveBeenCalledWith(
      {},
      CONFIG.vendorProject,
      { provider: 'github', jobId: 3 },
      500
    );
  });

  it("refuses another provider's reference", async () => {
    const p = provider();
    await expect(
      readCiLog(
        '/repo',
        { provider: 'azure-devops', buildId: 1, logId: 2 },
        deps(p)
      )
    ).rejects.toThrow('That log is not from GitHub');
    expect(p.fetchCiLog).not.toHaveBeenCalled();
  });
});
