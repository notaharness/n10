import { configuredRepository, configuredViewer } from '@n10/vcs-core';
import { PullRequestIdentityError } from '@n10/core';
import { readConfig, type RepositoryRef } from '@n10/vcs-core';
import { activeRepoIs } from './repo.js';
import { PROVIDERS } from './providers.js';

/**
 * The repository and account core's reads by identity check, read
 * afresh on every check: either can change while a read is in flight.
 * A repository that is no longer the open one is refused outright.
 */
export function openContext(cwd: string): {
  repository: () => RepositoryRef | null;
  viewer: () => string | null;
} {
  return {
    repository: () => {
      if (!activeRepoIs(cwd)) {
        throw new PullRequestIdentityError(
          `${cwd} is no longer the repository open in n10`
        );
      }
      return configuredRepository(readConfig(cwd), PROVIDERS);
    },
    viewer: () => configuredViewer(readConfig(cwd)),
  };
}
