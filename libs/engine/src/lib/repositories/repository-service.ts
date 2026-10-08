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
import {
  defaultCheckpointDir,
  resolveRepositoryRoot,
  VisitBaselines,
  type DiscoveryScan,
} from '@n10/core';
import { autoDetectProjectConfig } from '@n10/vcs-core';
import {
  createConfigService,
  type ConfigService,
  type ConfigServiceOptions,
} from '../config/api.js';

/** How long a parked repository's answers serve without a read behind
 *  them. Past it they still serve, with a read started behind them. */
export const PARKED_REPOSITORY_TTL_MS = 60 * 60 * 1000;

export interface RepositoryHandle {
  readonly cwd: string;
  readonly config: ConfigService;
  readonly worktrees: WorktreeService;
  readonly reviews: ReviewService;
  readonly sessions: SessionService;
  /** Another repository is selected: this one is not observed, and its
   *  reads serve what they hold (`PARKED_REPOSITORY_TTL_MS`). */
  parked(): boolean;
  /** Bring the repository's worktrees, sessions and pull request list up
   *  to date behind what they hold, unless a parked repository's are
   *  still warm. Returns at once. */
  prewarm(): void;
}

/**
 * Every repository opened or read this run, one selected. Selecting
 * another parks the one before: its observation stops, and its data
 * stays for the life of the service, so a pane of it can be shown from
 * what it holds at any time. Metadata comes from each handle's config
 * service and changes through its subscription, never a second store.
 */
export function createRepositoryService(
  options: Omit<ConfigServiceOptions, 'repo' | 'pullRequests'> & {
    pullRequests: Pick<
      PullRequestList,
      | 'credentialsChanged'
      | 'read'
      | 'lookupPullRequest'
      | 'subscribe'
      | 'getSnapshot'
      | 'refreshInBackground'
    >;
    worktreeWatchers?: WorktreeWatchers;
  }
) {
  const { worktreeWatchers, ...configOptions } = options;
  const handles = new Map<string, RepositoryHandle>();
  let current: RepositoryHandle | null = null;
  const connections = createSessionConnections();
  const lastScans = new Map<string, DiscoveryScan>();
  const baselines = new VisitBaselines(defaultCheckpointDir());
  function create(cwd: string): RepositoryHandle {
    try {
      autoDetectProjectConfig(cwd, options.providers);
    } catch {
      // Optional detection must not prevent opening a valid checkout.
    }
    const isCurrent = () => current?.cwd === cwd;
    const parked = () => !isCurrent();
    const freshness = { parked, parkedTtl: PARKED_REPOSITORY_TTL_MS };
    const config = createConfigService({ ...configOptions, repo: cwd });
    const worktrees = createWorktreeService({
      config,
      watchers: worktreeWatchers,
      freshness,
      rescanSessions: async () => {
        await sessions.scanNow();
      },
    });
    const reviews = createReviewService({
      config,
      worktrees,
      pullRequests: options.pullRequests,
      isCurrent,
      freshness,
      baselines,
    });
    const sessions = createSessionService({
      connections,
      lastScans,
      config,
      worktrees,
      isCurrent,
    });
    const handle: RepositoryHandle = {
      cwd,
      config,
      worktrees,
      reviews,
      sessions,
      parked,
      prewarm() {
        // Neither rejects: failures keep the last answer and say so in
        // their snapshots.
        void sessions.read();
        options.pullRequests.refreshInBackground(
          cwd,
          parked() ? { maxAge: PARKED_REPOSITORY_TTL_MS } : undefined
        );
      },
    };
    handles.set(cwd, handle);
    return handle;
  }
  return {
    getSnapshot: () => current,
    /** Select the repository at `path`, parking the one selected before. */
    open(path: string): RepositoryHandle {
      const cwd = resolveRepositoryRoot(path);
      const known = handles.get(cwd);
      if (known) {
        try {
          known.config.detect();
        } catch {
          known.config.reload();
        }
      }
      const next = known ?? create(cwd);
      if (next !== current) {
        current?.sessions.park();
        current = next;
      }
      return next;
    },
    /** The repository at `path` for reading, selected or not. */
    get(path: string): RepositoryHandle {
      const cwd = resolveRepositoryRoot(path);
      return handles.get(cwd) ?? create(cwd);
    },
    isActive: (cwd: string) => current?.cwd === cwd,
  };
}
