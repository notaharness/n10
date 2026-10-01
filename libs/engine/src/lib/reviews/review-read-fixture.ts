import * as vcs from '@n10/vcs-core';
import type { BranchPrMap } from '@n10/vcs-core';
import { EMPTY_PULL_REQUEST_LIST } from '../pull-requests/api.js';
import { vi } from 'vitest';
import type { ConfigSnapshot, ConfigService } from '../config/api.js';
import type { ReviewContextOptions } from './review-context.js';
import { createProviderReads } from './provider-reads.js';

type FixtureSnapshot = Omit<Partial<ConfigSnapshot>, 'provider'> & {
  provider?: object;
};
export function reviewReadFixture(
  current: () => FixtureSnapshot,
  isCurrent = () => true,
  lookupPullRequest: ReviewContextOptions['pullRequests']['lookupPullRequest'] = async () => ({
    kind: 'gone',
  })
) {
  vi.spyOn(vcs, 'readConfig').mockImplementation(
    () => current().config ?? ({} as vcs.AppConfig)
  );
  const listeners = new Set<() => void>();
  const config: ConfigService = {
    repo: '/repo',
    getSnapshot: () =>
      ({
        config: {},
        provider: null,
        repository: null,
        viewer: null,
        vcsConfigured: false,
        revision: 0,
        syncRevision: 0,
        ...current(),
      } as ConfigSnapshot),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload: vi.fn(),
    detect: vi.fn(),
    updateField: vi.fn(),
    updateKeybindFields: vi.fn(),
  };
  let list = EMPTY_PULL_REQUEST_LIST;
  const observers = new Set<(repo: string) => void>();
  const options = {
    config,
    isCurrent,
    pullRequests: {
      read: vi.fn(async () => ({})),
      lookupPullRequest,
      subscribe(listener: (repo: string) => void) {
        observers.add(listener);
        return () => {
          observers.delete(listener);
        };
      },
      getSnapshot: () => list,
    },
  };
  return {
    listChanged(prMap: BranchPrMap, repo = config.repo) {
      list = { ...list, prMap };
      for (const observer of observers) observer(repo);
    },
    options,
    service: createProviderReads(options),
    changed() {
      for (const listener of listeners) listener();
    },
  };
}
