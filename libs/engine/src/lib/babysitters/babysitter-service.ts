import { logError } from '@n10/logger';
import type { BabysitStatus } from '@n10/core';
import type { ConfigSnapshot } from '../config/api.js';
import type { PullRequestList } from '../pull-requests/api.js';
import { startPrBabysitter } from './pr-babysitter.js';
import type { PrBabysitter } from './babysit-types.js';

export type BabysitterEvent =
  | { type: 'changed'; repo: string }
  | { type: 'spawned'; repo: string; prId: number; name: string }
  | { type: 'ended'; repo: string; prId: number; sourceBranch: string };

export interface BabysitterPorts {
  config(repo: string): Pick<ConfigSnapshot, 'config' | 'provider'>;
  pullRequests: Pick<PullRequestList, 'lookupPullRequest'>;
  isCurrent(repo: string): boolean;
  paneSize(): { cols: number; rows: number };
  isForeignSession(name: string): boolean;
  spawned(name: string, repo: string): void;
}

interface Watch {
  promise: Promise<BabysitStatus>;
  handle?: PrBabysitter;
  branch?: string;
  blockedBranches: Set<string>;
}

/** Watches survive repository selection; only the selected scope may act. */
export function createBabysitterService(ports: BabysitterPorts) {
  const watches = new Map<string, Map<number, Watch>>();
  const snapshots = new Map<string, ReadonlyMap<number, BabysitStatus>>();
  const listeners = new Set<(event: BabysitterEvent) => void>();
  let disposed = false;

  function forRepo(repo: string): Map<number, Watch> {
    let entries = watches.get(repo);
    if (!entries) {
      entries = new Map();
      watches.set(repo, entries);
    }
    return entries;
  }
  function emit(event: BabysitterEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        logError('babysitter observer', error);
      }
    }
  }
  function stop(repo: string, prId: number): void {
    const entries = watches.get(repo);
    entries?.get(prId)?.handle?.stop();
    if (entries?.delete(prId)) emit({ type: 'changed', repo });
  }
  async function begin(repo: string, prId: number, watch: Watch) {
    const lookup = await ports.pullRequests.lookupPullRequest(repo, prId);
    if (
      disposed ||
      watches.get(repo)?.get(prId) !== watch ||
      !ports.isCurrent(repo)
    )
      throw new Error('Babysitting was cancelled before it started');
    if (lookup.kind !== 'found')
      throw new Error(`Pull request #${prId} is not in the sidebar`);
    const { pr } = lookup;
    if (watch.blockedBranches.has(pr.sourceBranch))
      throw new Error('Babysitting was cancelled for worktree removal');
    watch.branch = pr.sourceBranch;
    watch.handle = startPrBabysitter({
      pr,
      cwd: repo,
      getProvider: () => ports.config(repo).provider,
      getConfig: () => ports.config(repo).config,
      readPullRequest: () => ports.pullRequests.lookupPullRequest(repo, prId),
      paneSize: ports.paneSize,
      isForeignSession: ports.isForeignSession,
      isCurrent: () => ports.isCurrent(repo),
      onSpawned: (name) => {
        ports.spawned(name, repo);
        emit({ type: 'spawned', repo, prId, name });
      },
      onStatus: (status) => {
        if (watches.get(repo)?.get(prId) !== watch) return;
        if (status.phase !== 'ended') {
          emit({ type: 'changed', repo });
          return;
        }
        forRepo(repo).delete(prId);
        emit({ type: 'ended', repo, prId, sourceBranch: pr.sourceBranch });
      },
    });
    emit({ type: 'changed', repo });
    return watch.handle.status();
  }
  function start(repo: string, prId: number): Promise<BabysitStatus> {
    if (disposed) return Promise.reject(new Error('Babysitters have stopped'));
    const entries = forRepo(repo);
    const existing = entries.get(prId);
    if (existing)
      return existing.handle
        ? Promise.resolve(existing.handle.status())
        : existing.promise;
    const watch: Watch = {
      blockedBranches: new Set(),
      promise: Promise.resolve()
        .then(() => begin(repo, prId, watch))
        .catch((error: unknown) => {
          if (entries.get(prId) === watch) entries.delete(prId);
          throw error;
        }),
    };
    entries.set(prId, watch);
    return watch.promise;
  }
  return {
    start,
    stop,
    stopBranch(repo: string, branch: string): number[] {
      const stopped: number[] = [];
      for (const [prId, watch] of watches.get(repo) ?? []) {
        if (watch.branch === undefined) watch.blockedBranches.add(branch);
        if (watch.branch !== branch) continue;
        stop(repo, prId);
        stopped.push(prId);
      }
      return stopped;
    },
    getSnapshot(repo: string): ReadonlyMap<number, BabysitStatus> {
      const next = new Map<number, BabysitStatus>();
      for (const [prId, watch] of watches.get(repo) ?? []) {
        if (watch.handle) next.set(prId, watch.handle.status());
      }
      const before = snapshots.get(repo);
      if (
        before?.size === next.size &&
        [...next].every(([id, value]) => before.get(id) === value)
      )
        return before;
      snapshots.set(repo, next);
      return next;
    },
    subscribe(listener: (event: BabysitterEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      disposed = true;
      for (const [repo, entries] of watches) {
        for (const prId of entries.keys()) stop(repo, prId);
      }
      watches.clear();
      snapshots.clear();
      listeners.clear();
    },
  };
}
