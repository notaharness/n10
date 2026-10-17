import { keyForWorktree } from '../session-key.js';
import {
  worktreeScope,
  type WorktreeScope,
  canRemoveBranch,
  fastForwardMainBranch,
  listWorktrees,
} from '@n10/worktree-manager';
import { logError } from '@n10/logger';
import type {
  AppConfig,
  BranchPrMap,
  MergedBranchHeads,
  VcsProvider,
} from '@n10/vcs-core';
import { isSessionAlive } from '../pty-registry.js';
import { hasLiveTmuxSession } from '../session-backend.js';
import {
  clearVerdictAt,
  type WorktreeRemovalCheck,
} from '../session/remove-worktree.js';
import { countBranchConflicts } from './conflicts.js';
import { fetchRefs } from './fetch-queue.js';
import { mergedTip, type MergedTip } from './merged-tip.js';

// Operations in a sync pass. The engine owns scheduling, state and notices.

/** One sync pass over the repository at `cwd`: fetch all remotes
 *  (pruning), through the fetch line every other fetch of the
 *  repository waits in, then fast-forward its main branch to what was
 *  fetched. Every step names cwd. A failed fetch rejects so the engine keeps
 *  the last successful state rather than publishing a false success time. */
export async function syncRemote(cwd: string): Promise<number> {
  if (!(await fetchRefs({ cwd, refs: 'all' }))) {
    throw new Error('Could not fetch from origin');
  }
  await fastForwardMainBranch(cwd);
  return Date.now();
}

/**
 * Decide which mid-rebase branches to warn about this sync without
 * re-warning ones already flagged. Given the branches currently blocked
 * from auto-delete by an in-progress rebase and the set warned on the
 * previous sync, return the branches to warn about now plus the set to
 * carry forward. A branch drops out of the carried set once it stops
 * rebasing, so a later rebase of the same branch warns again instead of
 * staying silent.
 */
function diffRebaseWarnings(
  rebasingNow: readonly string[],
  alreadyWarned: ReadonlySet<string>
): { toWarn: string[]; nextWarned: Set<string> } {
  return {
    toWarn: rebasingNow.filter((branch) => !alreadyWarned.has(branch)),
    nextWarned: new Set(rebasingNow),
  };
}

/**
 * The slice of config the sweep reads. Narrow on purpose: callers with
 * a full AppConfig may pass it, but the sweep must not depend on
 * unrelated config churn.
 */
type SweepConfig = Pick<
  AppConfig,
  'vendorAuth' | 'vendorProject' | 'autoDeleteOnMerge' | 'worktreePath'
>;

/** Called with the merged branch and the verdict to remove it with:
 *  `clear`, at the tip its merged pull request carried. */
type AutoDelete = (
  branch: string,
  approved: WorktreeRemovalCheck
) => void | Promise<void>;

/** Why the sweep leaves a merged branch, as the log says it. */
const SKIPPED: Record<Exclude<MergedTip, { tip: string }>['skip'], string> = {
  'no-head': 'its merged pull request named no head commit',
  'no-tip': 'git cannot find its tip',
  'new-work': 'it has commits its merged pull request did not',
  'unknown-head': 'the head of its merged pull request is not in this clone',
};

/**
 * Delete the worktrees of merged branches that are safe to delete, and
 * return the ones a rebase is holding up. Null means the caller
 * cancelled partway, which is not the same as "nothing was blocked".
 */
async function autoDeleteMerged(args: {
  merged: MergedBranchHeads;
  onAutoDelete: AutoDelete;
  isCancelled: () => boolean;
  scope: WorktreeScope;
}): Promise<string[] | null> {
  const { merged, onAutoDelete, isCancelled, scope } = args;
  const { cwd } = scope;
  const rebasingNow: string[] = [];
  // One listing for the pass: each merged branch's session is the one in
  // the checkout that has it.
  const checkouts = await listWorktrees(scope);
  for (const [branch, heads] of merged) {
    // A live agent prevents auto-deletion even when n10 is detached.
    // Deleting its working directory would disrupt the running process.
    const checkout = checkouts.find((w) => w.branch === branch);
    if (!checkout) continue;
    const sessionName = keyForWorktree(checkout, cwd);
    if (isSessionAlive(sessionName) || hasLiveTmuxSession(sessionName)) {
      logError(
        'sweepMergedBranches',
        `Skipping auto-delete of ${branch}: agent session is running`
      );
      continue;
    }
    // A merge vouches for the commits its pull request carried, not for
    // the branch name: work committed since exists nowhere else.
    const judged = await mergedTip(branch, heads, checkout.path, cwd);
    if (!('tip' in judged)) {
      logError(
        'sweepMergedBranches',
        `Skipping auto-delete of ${branch}: ${SKIPPED[judged.skip]}`
      );
      continue;
    }
    const { tip } = judged;
    const check = await canRemoveBranch(branch, scope, {
      confirmedMerged: true,
    });
    if (isCancelled()) return null;
    if (check.safe) {
      await onAutoDelete(branch, await clearVerdictAt(checkout.path, tip));
    } else {
      if (check.reason === 'rebase in progress') rebasingNow.push(branch);
      logError(
        'sweepMergedBranches',
        `Skipping auto-delete of ${branch}: ${check.reason}`
      );
    }
  }
  return rebasingNow;
}

export interface MergedSweepResult {
  /** Branches (of those given) whose PRs have been merged. */
  merged: Set<string>;
  /** Carry this into the next sweep's `warnedRebase`. */
  nextWarned: Set<string>;
}

/**
 * Fetch which of `branches` have merged PRs and, when
 * `config.autoDeleteOnMerge` is on, auto-delete the ones that are safe
 * to remove (`canRemoveBranch` with `confirmedMerged`), warning once per rebase
 * episode about branches blocked by an in-progress rebase.
 */
export async function sweepMergedBranches(opts: {
  provider: VcsProvider | null;
  vcsConfigured: boolean;
  config: SweepConfig;
  branches: string[];
  /** Branches already warned about an in-progress rebase. */
  warnedRebase: ReadonlySet<string>;
  onAutoDelete: AutoDelete;
  onRebaseInProgress: (branch: string) => void;
  /** The engine cancels stale passes between async steps. */
  isCancelled: () => boolean;
  /** Captured repository root for every Git call and session identity. */
  cwd: string;
}): Promise<MergedSweepResult> {
  const {
    provider,
    vcsConfigured,
    config,
    branches,
    warnedRebase,
    onAutoDelete,
    onRebaseInProgress,
    isCancelled,
    cwd,
  } = opts;
  const keepWarned = new Set(warnedRebase);
  const fetchMerged = provider?.fetchMergedBranches;
  if (!fetchMerged || !vcsConfigured || branches.length === 0) {
    return { merged: new Set(), nextWarned: keepWarned };
  }

  const heads = await fetchMerged(
    config.vendorAuth,
    config.vendorProject,
    branches
  );
  const merged = new Set(heads.keys());
  if (isCancelled()) return { merged, nextWarned: keepWarned };
  if (!config.autoDeleteOnMerge) {
    return { merged, nextWarned: keepWarned };
  }

  const rebasingNow = await autoDeleteMerged({
    merged: heads,
    onAutoDelete,
    isCancelled,
    scope: worktreeScope(cwd, { template: config.worktreePath }),
  });
  if (rebasingNow === null) return { merged, nextWarned: keepWarned };

  const { toWarn, nextWarned } = diffRebaseWarnings(rebasingNow, warnedRebase);
  for (const branch of toWarn) onRebaseInProgress(branch);
  return { merged, nextWarned };
}

/**
 * Batch conflict counting, by the one predicate the babysitter uses
 * too (`conflicts.ts`): a branch with a pull request in `prMap` is
 * judged on the remote refs against its target; the rest locally
 * against origin's main branch. A branch that fails to check counts 0.
 */
export async function computeConflictCounts(
  branches: string[],
  prMap: BranchPrMap = {},
  cwd?: string
): Promise<Map<string, number>> {
  const entries = await Promise.all(
    branches.map(async (branch) => {
      try {
        const count = await countBranchConflicts(
          branch,
          prMap[branch] ?? undefined,
          cwd
        );
        return [branch, count] as const;
      } catch {
        return [branch, 0] as const;
      }
    })
  );
  return new Map(entries);
}
