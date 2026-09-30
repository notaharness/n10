import { logError } from '@n10/logger';
import { remoteSyncIntervalMs } from './sync-interval.js';
import type { WorktreeRemovalCheck, WorktreeRemovalOutcome } from '@n10/core';
import type { ConfigSnapshot } from '../config/config-service.js';
import type { PullRequestList } from '../pull-requests/pull-request-list.js';
import type { WorktreeService } from '../worktrees/worktree-service.js';
import { EMPTY_SYNC_SNAPSHOT } from './sync-snapshot.js';
import type { SyncNotice, SyncSnapshot } from './sync-snapshot.js';
import { runSyncPass } from './sync-pass.js';

export interface RemoteSyncOptions {
  config: {
    repo: string;
    getSnapshot(): Pick<
      ConfigSnapshot,
      'config' | 'provider' | 'vcsConfigured' | 'syncRevision'
    >;
    subscribe(listener: () => void): () => void;
  };
  pullRequests: Pick<PullRequestList, 'getSnapshot'>;
  worktrees: Pick<WorktreeService, 'remove' | 'refresh'>;
}

export interface RemoteSync {
  getSnapshot(): SyncSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeNotices(listener: (notice: SyncNotice) => void): () => void;
  start(): void;
  /** Cancel future work; wait only for guarded removals that have started. */
  stop(): Promise<void>;
  /** Never rejects. Concurrent requests share one queued follow-up pass. */
  refresh(): Promise<void>;
}

/** One bounded schedule and complete sync pass for one captured repository. */
export function createRemoteSync(options: RemoteSyncOptions): RemoteSync {
  const { config, pullRequests, worktrees } = options;
  const repo = config.repo;
  let snapshot = EMPTY_SYNC_SNAPSHOT;
  let warned: ReadonlySet<string> = new Set();
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeConfig: (() => void) | undefined;
  let revision = config.getSnapshot().syncRevision;
  let active: Promise<void> | undefined;
  let queued = false;
  const mutations = new Set<Promise<WorktreeRemovalOutcome>>();
  const listeners = new Set<() => void>();
  const noticeListeners = new Set<(notice: SyncNotice) => void>();

  function publish(patch: Partial<SyncSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        logError('sync observer', error);
      }
    }
  }
  function notice(event: SyncNotice): void {
    for (const listener of noticeListeners) {
      try {
        listener(event);
      } catch (error) {
        logError('sync notice observer', error);
      }
    }
  }
  async function remove(branch: string, approved: WorktreeRemovalCheck) {
    const task = worktrees.remove(branch, approved);
    mutations.add(task);
    try {
      return await task;
    } finally {
      mutations.delete(task);
    }
  }
  async function pass(gen: number): Promise<void> {
    try {
      const current = config.getSnapshot();
      if (!current.vcsConfigured) return;
      publish({ loading: true, error: null });
      const result = await runSyncPass({
        repo,
        config: current,
        pullRequests,
        worktrees,
        warned,
        remove,
        notice,
        cancelled: () => gen !== generation,
      });
      if (!result) return;
      warned = result.nextWarned;
      publish({
        merged: result.merged,
        conflicts: result.conflicts,
        lastGitSyncAt: result.lastGitSyncAt ?? snapshot.lastGitSyncAt,
        error: result.error,
      });
    } catch (error) {
      if (gen !== generation) return;
      const message = error instanceof Error ? error.message : String(error);
      publish({ error: message });
      notice({ type: 'failed', repo, error: message });
    } finally {
      if (gen === generation && snapshot.loading) publish({ loading: false });
    }
  }
  async function drain(): Promise<void> {
    do {
      queued = false;
      await pass(generation);
    } while (queued);
    active = undefined;
  }
  function refresh(): Promise<void> {
    if (active) {
      queued = true;
      return active;
    }
    active = drain();
    return active;
  }
  function schedule(): void {
    if (timer) clearInterval(timer);
    generation += 1;
    const current = config.getSnapshot();
    revision = current.syncRevision;
    timer = setInterval(() => {
      // Busy timer ticks are skipped, never accumulated behind a slow read.
      if (!active) void refresh();
    }, remoteSyncIntervalMs(current.config.mergePollInterval));
    timer.unref?.();
    void refresh();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeNotices(listener) {
      noticeListeners.add(listener);
      return () => {
        noticeListeners.delete(listener);
      };
    },
    refresh,
    start() {
      if (unsubscribeConfig) return;
      unsubscribeConfig = config.subscribe(() => {
        if (revision !== config.getSnapshot().syncRevision) schedule();
      });
      schedule();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      unsubscribeConfig?.();
      unsubscribeConfig = undefined;
      generation += 1;
      queued = false;
      if (snapshot.loading) publish({ loading: false });
      await Promise.allSettled(mutations);
    },
  };
}
