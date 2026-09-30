import { configuredRepository, configuredViewer } from '@n10/vcs-core';
import { PullRequestIdentityError, type SnapshotSources } from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { lookupPullRequest } from './pull-requests.js';
import { activeRepoIs } from './repo.js';
import { PROVIDERS } from './providers.js';

/**
 * The open repository's facts that a read by identity checks, before
 * its reads and after them: which repository, read as whom, and the
 * shared list cache, so a read never costs the list a fetch of its
 * own. Read afresh on every check: the open repository, its config and
 * the account can all change while the reads are in flight.
 */
export function identitySources(
  cwd: string
): Pick<SnapshotSources, 'repository' | 'viewer' | 'lookup'> {
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
    lookup: (prId) => lookupPullRequest(cwd, prId),
  };
}
