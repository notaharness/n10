import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { N10HostApi, RepoInfo } from '../../../host/contract.js';
import { updateSettingOptions } from './mutations-settings.js';
import { keys } from './query-keys.js';

function stubHost(api: Partial<N10HostApi>): void {
  (globalThis as { window?: unknown }).window = { n10: api };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const REPO: RepoInfo = {
  cwd: '/repo',
  providerId: 'github',
  vcsConfigured: true,
  repository: {
    provider: 'github',
    host: 'github.com',
    repository: 'acme/app',
  },
  viewer: 'bob',
};

describe('saving a setting', () => {
  it('adopts the account it names, so pull requests are read as that account', async () => {
    // The repository's entry is written when a repository is opened and
    // never polled: without the re-read, every snapshot would still be
    // asked as bob and refused by the host.
    let viewer = 'bob';
    stubHost({
      updateSettingsField: () => {
        viewer = 'carol';
        return Promise.resolve() as never;
      },
      getRepo: () => Promise.resolve({ ...REPO, viewer }),
    });
    const qc = new QueryClient();
    qc.setQueryData(keys.repo, REPO);

    await new MutationObserver(qc, updateSettingOptions(qc, '/repo')).mutate({
      ref: { label: 'GitHub', key: 'username' },
      value: 'carol',
    });

    expect(qc.getQueryData(keys.repo)).toEqual({ ...REPO, viewer: 'carol' });
  });

  it('reports the save as saved when only the re-read fails', async () => {
    stubHost({
      updateSettingsField: () => Promise.resolve() as never,
      getRepo: () => Promise.reject(new Error('host is busy')),
    });
    const qc = new QueryClient();
    qc.setQueryData(keys.repo, REPO);

    await expect(
      new MutationObserver(qc, updateSettingOptions(qc, '/repo')).mutate({
        ref: { label: 'GitHub', key: 'username' },
        value: 'carol',
      })
    ).resolves.toBeUndefined();
    expect(qc.getQueryData(keys.repo)).toEqual(REPO);
  });
});
