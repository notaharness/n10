import { vi } from 'vitest';
import type { VcsProvider } from '@n10/vcs-core';
import {
  createPullRequestList,
  createRemoteSync,
  createReviewService,
  createWorktreeService,
} from '@n10/engine';
import type {
  ConfigService,
  ConfigSnapshot,
  PullRequestList,
} from '@n10/engine';

/** Real engine resources under an inert config adapter; no Git or provider reads at construction. */
export function reviewEngineFixture(
  provider: VcsProvider | null = null,
  list?: PullRequestList
) {
  const snapshot: ConfigSnapshot = {
    config: { vendorAuth: {}, vendorProject: {} },
    provider,
    vcsConfigured: provider !== null,
    repository: null,
    viewer: null,
    revision: 0,
    syncRevision: 0,
  };
  const config: ConfigService = {
    repo: '/repo',
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    reload: vi.fn(),
    detect: vi.fn(),
    updateField: vi.fn(),
    updateKeybindFields: vi.fn(),
  };
  const pullRequests = list ?? createPullRequestList({ providers: [] });
  const worktrees = createWorktreeService({ config });
  const sync = createRemoteSync({ config, pullRequests, worktrees });
  const reviews = createReviewService({
    config,
    pullRequests,
    worktrees,
    isCurrent: () => true,
  });
  return { repo: '/repo', pullRequests, worktrees, sync, reviews };
}
