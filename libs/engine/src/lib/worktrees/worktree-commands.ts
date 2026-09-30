import {
  checkWorktreeRemoval,
  removeWorktreeSession,
  fetchRefs,
  keyForWorktree,
} from '@n10/core';
import type { WorktreeRemovalCheck, WorktreeRemovalOutcome } from '@n10/core';
import {
  createWorktree,
  listWorktrees,
  rebaseOntoMaster,
  worktreeScope,
} from '@n10/worktree-manager';
import type {
  Machine,
  WorktreeScope,
  WorktreeInfo,
} from '@n10/worktree-manager';
import { logError } from '@n10/logger';
import type { ConfigSnapshot } from '../config/config-service.js';

export interface WorktreeConfig {
  repo: string;
  getSnapshot(): Pick<ConfigSnapshot, 'config'>;
  subscribe(listener: () => void): () => void;
}

export interface WorktreeWatchers {
  suspend(repo: string, branch: string): number[];
  resume(repo: string, id: number): Promise<unknown>;
  isCurrent(repo: string): boolean;
}

export type WorktreeTarget = { branch: string } | { session: string };
export interface WorktreeCommands {
  checkRemoval(branch: string): Promise<WorktreeRemovalCheck>;
  remove(
    branch: string,
    approved: WorktreeRemovalCheck
  ): Promise<WorktreeRemovalOutcome>;
  create(
    branch: string,
    remote?: { cwd: string; machine: Machine }
  ): Promise<string>;
  find(target: WorktreeTarget): Promise<WorktreeInfo | null>;
  resolve(target: WorktreeTarget): Promise<string | null>;
  fetchBranches(): Promise<void>;
  rebase(target: WorktreeTarget): Promise<'success' | 'conflict' | 'error'>;
}

/** Commands capture path policy before their first await. Core guards deletion. */
export function createWorktreeCommands(options: {
  config: Pick<WorktreeConfig, 'repo' | 'getSnapshot'>;
  watchers?: WorktreeWatchers;
  changed(): Promise<unknown>;
  rescanSessions?(): Promise<void>;
}): WorktreeCommands {
  const { config, watchers, changed } = options;
  const repo = config.repo;
  const scope = () =>
    worktreeScope(repo, { template: config.getSnapshot().config.worktreePath });
  async function create(
    branch: string,
    remote?: { cwd: string; machine: Machine }
  ): Promise<string> {
    const at = scope();
    const target = remote
      ? worktreeScope(remote.cwd, {
          template: config.getSnapshot().config.worktreePath,
          machine: remote.machine,
        })
      : at;
    const path = await createWorktree(branch, target);
    if (!path) throw new Error(`Failed to create a worktree for "${branch}"`);
    if (!remote) await changed();
    return path;
  }
  async function locate(
    target: WorktreeTarget,
    at: WorktreeScope
  ): Promise<WorktreeInfo | null> {
    const checkouts = await listWorktrees(at);
    return (
      checkouts.find((wt) =>
        'branch' in target
          ? wt.branch === target.branch
          : keyForWorktree(wt, repo) === target.session
      ) ?? null
    );
  }
  async function resume(stopped: number[]): Promise<void> {
    if (!watchers?.isCurrent(repo)) return;
    for (const id of stopped) {
      await watchers
        .resume(repo, id)
        .catch((error: unknown) => logError('worktree watcher restart', error));
    }
  }
  return {
    create,
    find: (target) => locate(target, scope()),
    checkRemoval: (branch) => checkWorktreeRemoval(branch, scope()),
    async remove(branch, approved) {
      const at = scope();
      const stopped = watchers?.suspend(repo, branch) ?? [];
      let gone = false;
      try {
        await options.rescanSessions?.();
        const outcome = await removeWorktreeSession(branch, approved, at);
        gone = outcome === 'removed' || outcome === 'kept-branch';
        await options.rescanSessions?.();
        await changed();
        return outcome;
      } finally {
        if (!gone) await resume(stopped);
      }
    },
    async resolve(target) {
      return 'branch' in target
        ? create(target.branch)
        : (await locate(target, scope()))?.path ?? null;
    },
    async fetchBranches() {
      if (!(await fetchRefs({ cwd: repo, refs: 'all' })))
        throw new Error(`Failed to fetch repository refs: ${repo}`);
      await changed();
    },
    async rebase(target) {
      const at = scope();
      const checkout = await locate(target, at);
      if (!checkout) throw new Error('No worktree found for selected session');
      const outcome = await rebaseOntoMaster(checkout.path, at.machine);
      await changed();
      return outcome;
    },
  };
}
