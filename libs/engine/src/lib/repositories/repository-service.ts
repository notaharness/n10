import {
  createSessionConnections,
  createSessionService,
  type SessionService,
} from '../sessions/api.js';
import { createReviewService, type ReviewService } from '../reviews/api.js';
import type { PullRequestList } from '../pull-requests/api.js';
import {
  createWorktreeService,
  type WorktreeService,
  type WorktreeWatchers,
} from '../worktrees/api.js';
import { resolveRepositoryRoot, type DiscoveryScan } from '@n10/core';
import { autoDetectProjectConfig } from '@n10/vcs-core';
import {
  createConfigService,
  type ConfigService,
  type ConfigServiceOptions,
} from '../config/api.js';

export interface RepositoryHandle {
  readonly cwd: string;
  readonly config: ConfigService;
  readonly worktrees: WorktreeService;
  readonly reviews: ReviewService;
  readonly sessions: SessionService;
}

/** Selection owns a captured-repo config service; metadata comes from that
 * service's snapshot and changes through its subscription, never a second store. */
export function createRepositoryService(
  options: Omit<ConfigServiceOptions, 'repo' | 'pullRequests'> & {
    pullRequests: Pick<
      PullRequestList,
      | 'credentialsChanged'
      | 'read'
      | 'lookupPullRequest'
      | 'subscribe'
      | 'getSnapshot'
    >;
  }
) {
  let current: RepositoryHandle | null = null;
  const connections = createSessionConnections();
  const lastScans = new Map<string, DiscoveryScan>();
  return {
    getSnapshot: () => current,
    open(
      path: string,
      ports: { worktreeWatchers?: WorktreeWatchers } = {}
    ): RepositoryHandle {
      const cwd = resolveRepositoryRoot(path);
      if (current?.cwd === cwd) {
        try {
          current.config.detect();
        } catch {
          current.config.reload();
        }
      } else {
        try {
          autoDetectProjectConfig(cwd, options.providers);
        } catch {
          // Optional detection must not prevent opening a valid checkout.
        }
        const config = createConfigService({ ...options, repo: cwd });
        const worktrees = createWorktreeService({
          config,
          watchers: ports.worktreeWatchers,
          rescanSessions: async () => {
            await sessions.scanNow();
          },
        });
        const reviews = createReviewService({
          config,
          worktrees,
          pullRequests: options.pullRequests,
          isCurrent: () => current?.cwd === cwd,
        });
        const sessions = createSessionService({
          connections,
          lastScans,
          config,
          worktrees,
          isCurrent: () => current?.sessions === sessions,
        });
        current?.sessions.dispose();
        current?.reviews.dispose();
        current?.worktrees.dispose();
        current = { cwd, config, worktrees, reviews, sessions };
      }
      return current;
    },
    isActive: (cwd: string) => current?.cwd === cwd,
  };
}
