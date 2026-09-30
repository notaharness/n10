import { createSessionConnections } from '../sessions/session-connections.js';
import {
  createSessionService,
  type SessionService,
} from '../sessions/session-service.js';
import {
  createReviewService,
  type ReviewService,
} from '../reviews/review-service.js';
import type { PullRequestList } from '../pull-requests/pull-request-list.js';
import {
  createWorktreeService,
  type WorktreeService,
} from '../worktrees/worktree-service.js';
import type { WorktreeWatchers } from '../worktrees/worktree-commands.js';
import { resolveRepositoryRoot } from '@n10/core';
import { autoDetectProjectConfig } from '@n10/vcs-core';
import { createConfigService } from '../config/config-service.js';
import type {
  ConfigService,
  ConfigServiceOptions,
} from '../config/config-service.js';

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
