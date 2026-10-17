import { readConfig, configuredViewer } from '@n10/vcs-core';
import { PullRequestIdentityError } from '@n10/core';
import type { SnapshotSources } from '@n10/core';
import type { ConfigService, ConfigSnapshot } from '../config/api.js';
import { configEffects } from '../config/api.js';
import type { PullRequestList } from '../pull-requests/api.js';
import type { ReadFreshness } from '../kernel/read-freshness.js';

export interface ReviewContextOptions {
  config: ConfigService;
  pullRequests: Pick<
    PullRequestList,
    'lookupPullRequest' | 'subscribe' | 'getSnapshot'
  >;
  /** Whether the repository is the selected one: only it takes writes. */
  isCurrent(): boolean;
  /** Reads of a parked repository serve what they hold. */
  freshness?: ReadFreshness;
}

/** Identity is checked around each read, including config edits outside
 *  n10. Reads go to whichever repository they are asked of; writes only
 *  to the selected one (`selected`). */
export function createReviewContext(options: ReviewContextOptions) {
  const { config, pullRequests, isCurrent } = options;
  function current(): ConfigSnapshot {
    const snapshot = config.getSnapshot();
    const disk = readConfig(config.repo);
    if (
      configEffects(snapshot.config, disk).credentials ||
      configuredViewer(snapshot.config) !== configuredViewer(disk)
    )
      throw new PullRequestIdentityError(
        'The review account or repository changed; refresh the repository'
      );
    return snapshot;
  }
  const sources: Pick<SnapshotSources, 'repository' | 'viewer' | 'lookup'> = {
    repository: () => current().repository,
    viewer: () => current().viewer,
    lookup: (prId) => pullRequests.lookupPullRequest(config.repo, prId),
  };
  function selected(): ConfigSnapshot {
    if (!isCurrent())
      throw new PullRequestIdentityError('This repository is no longer open');
    return current();
  }
  function assertUnchanged(start: ConfigSnapshot, next = current()) {
    if (
      configEffects(start.config, next.config).credentials ||
      start.viewer !== next.viewer
    ) {
      throw new PullRequestIdentityError(
        'The review account or repository changed during the read'
      );
    }
  }
  return {
    current,
    selected,
    sources,
    assertUnchanged,
    /** `assertUnchanged`, and still the selected repository: before a write. */
    assertWritable(start: ConfigSnapshot) {
      assertUnchanged(start, selected());
    },
  };
}

export function requirePullRequestNumber(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error('Invalid PR id');
  return value;
}
