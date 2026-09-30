import { isDeepStrictEqual } from 'node:util';
import {
  listWorktrees,
  listBranches,
  listAllBranches,
  worktreeScope,
} from '@n10/worktree-manager';
import type { WorktreeInfo } from '@n10/worktree-manager';
import { logError } from '@n10/logger';
import { createWorktreeCommands } from './worktree-commands.js';
import type {
  WorktreeCommands,
  WorktreeWatchers,
  WorktreeConfig,
} from './worktree-commands.js';

export interface WorktreeSnapshot {
  worktrees: WorktreeInfo[];
  branches: string[];
  allBranches: string[];
  loading: boolean;
  error: string | null;
}
export interface WorktreeService extends WorktreeCommands {
  getSnapshot(): WorktreeSnapshot;
  subscribe(listener: () => void): () => void;
  /** Cached for one second; reads never reject and failures preserve known data. */
  read(): Promise<WorktreeSnapshot>;
  /** Concurrent refreshes join one follow-up after the active read. */
  refresh(): Promise<WorktreeSnapshot>;
  dispose(): void;
}

function readError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const reason = message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('Command failed'));
  return `Could not read worktrees and branches${reason ? `: ${reason}` : ''}`;
}

/** One repository's worktree and branch resources, shared by every consumer. */
export function createWorktreeService(options: {
  config: WorktreeConfig;
  watchers?: WorktreeWatchers;
}): WorktreeService {
  const { config } = options;
  let snapshot: WorktreeSnapshot = {
    worktrees: [],
    branches: [],
    allBranches: [],
    loading: false,
    error: null,
  };
  let fetchedAt: number | null = null;
  let template = config.getSnapshot().config.worktreePath;
  let generation = 0;
  let disposed = false;
  let queued = false;
  let active: Promise<WorktreeSnapshot> | undefined;
  const listeners = new Set<() => void>();
  function publish(patch: Partial<WorktreeSnapshot>): void {
    const next = { ...snapshot, ...patch };
    if (isDeepStrictEqual(next, snapshot)) return;
    snapshot = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        logError('worktree observer', error);
      }
    }
  }
  async function pass(): Promise<void> {
    const gen = generation;
    const scope = worktreeScope(config.repo, { template });
    publish({ loading: true, error: null });
    try {
      const [worktrees, branches, allBranches] = await Promise.all([
        listWorktrees(scope),
        listBranches(scope.cwd),
        listAllBranches(scope.cwd),
      ]);
      if (disposed || gen !== generation) return;
      fetchedAt = Date.now();
      publish({ worktrees, branches, allBranches });
    } catch (error) {
      logError('worktree read', error);
      if (!disposed && gen === generation) publish({ error: readError(error) });
    } finally {
      if (!disposed && gen === generation) publish({ loading: false });
    }
  }
  async function drain(): Promise<WorktreeSnapshot> {
    do {
      queued = false;
      await pass();
    } while (queued && !disposed);
    active = undefined;
    return snapshot;
  }
  function refresh(): Promise<WorktreeSnapshot> {
    if (disposed) return Promise.resolve(snapshot);
    if (active) {
      queued = true;
      return active;
    }
    active = drain();
    return active;
  }
  const unsubscribeConfig = config.subscribe(() => {
    const next = config.getSnapshot().config.worktreePath;
    if (next === template) return;
    template = next;
    generation += 1;
    fetchedAt = null;
    void refresh();
  });
  return {
    ...createWorktreeCommands({ ...options, changed: refresh }),
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read() {
      if (active) return active;
      return fetchedAt !== null && Date.now() - fetchedAt < 1_000
        ? Promise.resolve(snapshot)
        : refresh();
    },
    refresh,
    dispose() {
      disposed = true;
      generation += 1;
      queued = false;
      unsubscribeConfig();
      listeners.clear();
    },
  };
}
