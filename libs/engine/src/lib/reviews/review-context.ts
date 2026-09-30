import { PullRequestIdentityError } from '@n10/core';
import type { SnapshotSources } from '@n10/core';
import type {
  ConfigService,
  ConfigSnapshot,
} from '../config/config-service.js';
import { configEffects } from '../config/config-effects.js';
import type { PullRequestList } from '../pull-requests/pull-request-list.js';

export interface ReviewContextOptions {
  config: ConfigService;
  pullRequests: Pick<
    PullRequestList,
    'lookupPullRequest' | 'subscribe' | 'getSnapshot'
  >;
  isCurrent(): boolean;
}

/** Identity is checked around each read, including config edits outside n10. */
export function createReviewContext(options: ReviewContextOptions) {
  const { config, pullRequests, isCurrent } = options;
  function current(): ConfigSnapshot {
    if (!isCurrent())
      throw new PullRequestIdentityError('This repository is no longer open');
    config.reload();
    return config.getSnapshot();
  }
  const sources: Pick<SnapshotSources, 'repository' | 'viewer' | 'lookup'> = {
    repository: () => current().repository,
    viewer: () => current().viewer,
    lookup: (prId) => pullRequests.lookupPullRequest(config.repo, prId),
  };
  return {
    current,
    sources,
    assertUnchanged(start: ConfigSnapshot) {
      const next = current();
      if (
        configEffects(start.config, next.config).credentials ||
        start.viewer !== next.viewer
      ) {
        throw new PullRequestIdentityError(
          'The review account or repository changed during the read'
        );
      }
    },
  };
}

export function requirePullRequestNumber(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error('Invalid PR id');
  return value;
}
