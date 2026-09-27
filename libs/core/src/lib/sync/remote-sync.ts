import { keyForWorktree } from '../session-key.js';
import {
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

// ── Remote sync core ─────────────────────────────────────────────
//
// The shell-agnostic heart of the remote sync loop: fetch + fast-
// forward, the merged-branch sweep (with auto-delete-on-merge), and
// batch conflict counting. The TUI drives these from its hooks
// (useRemoteSync / useMergedBranches / useConflictCounts); the desktop
// host drives them from a timer. Behavior lives here exactly once —
// the shells only own scheduling and how results are displayed.

export const REMOTE_SYNC_DEFAULT_MS = 3_600_000; // 1 hour
export const REMOTE_SYNC_MIN_MS = 300_000; // 5 minutes

export function remoteSyncIntervalMs(
  mergePollInterval: number | undefined
): number {
  return Math.max(
    REMOTE_SYNC_MIN_MS,
    mergePollInterval ?? REMOTE_SYNC_DEFAULT_MS
  );
}

/** One sync pass over the repository at `cwd`: fetch all remotes
 *  (pruning), through the fetch line every other fetch of the
 *  repository waits in, then fast-forward its main branch to what was
 *  fetched. Every step names `cwd`; the process's directory may be
 *  another repository by the time one runs. Never throws; returns the
 *  completion timestamp. */
export async function syncRemote(cwd = process.cwd()): Promise<number> {
  try {
    await fetchRefs({ cwd, refs: 'all' });
    await fastForwardMainBranch(cwd);
  } catch (err: unknown) {
    logError('remote-sync', err);
  }
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
export function diffRebaseWarnings(
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
  'vendorAuth' | 'vendorProject' | 'autoDeleteOnMerge'
>;

/** Called with a merged branch's checkout session, the branch, and the
 *  verdict to remove it with: `clear`, at the tip its merged pull
 *  request carried. */
type AutoDelete = (
  sessionName: string,
  branch: string,
  approved: WorktreeRemovalCheck
) => void | Promise<void>;

/** Why the sweep leaves a merged branch, as the log says it. */
const SKIPPED: Record<Exclude<MergedTip, { tip: string }>['skip'], string> = {
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
  cwd: string | undefined;
}): Promise<string[] | null> {
  const { merged, onAutoDelete, isCancelled, cwd } = args;
  const rebasingNow: string[] = [];
  // One listing for the pass: each merged branch's session is the one in
  // the checkout that has it.
  const checkouts = await listWorktrees(cwd);
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
    // the branch name: work committed since exists nowhere else. A head
    // git lacks is fetched in the repository being swept.
    const judged = await mergedTip(
      branch,
      heads,
      checkout.path,
      cwd ?? process.cwd()
    );
    if (!('tip' in judged)) {
      logError(
        'sweepMergedBranches',
        `Skipping auto-delete of ${branch}: ${SKIPPED[judged.skip]}`
      );
      continue;
    }
    const { tip } = judged;
    const check = await canRemoveBranch(branch, { confirmedMerged: true, cwd });
    if (isCancelled()) return null;
    if (check.safe) {
      await onAutoDelete(
        sessionName,
        branch,
        await clearVerdictAt(checkout.path, tip)
      );
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
  /** Fires with the merged set as soon as it is known, before the
   *  (potentially slow) auto-delete pass — lets UIs show merged
   *  badges without waiting for deletions. */
  onMerged?: (merged: Set<string>) => void;
  onAutoDelete: AutoDelete;
  onRebaseInProgress: (branch: string) => void;
  /** Abort between async steps (the TUI passes its effect-cancel flag). */
  isCancelled?: () => boolean;
  /** The repository's root, which every git call and session key names;
   *  the process's repository when not given. The desktop passes the
   *  repository it captured, since the process's directory follows
   *  whichever repository is open by the time a step runs. */
  cwd?: string;
}): Promise<MergedSweepResult> {
  const {
    provider,
    vcsConfigured,
    config,
    branches,
    warnedRebase,
    onMerged,
    onAutoDelete,
    onRebaseInProgress,
    isCancelled = () => false,
    cwd,
  } = opts;
  const keepWarned = new Set(warnedRebase);
  const fetchMerged = provider?.fetchMergedBranches;
  if (!fetchMerged || !vcsConfigured || branches.length === 0) {
    return { merged: new Set(), nextWarned: keepWarned };
  }

  let heads: MergedBranchHeads;
  try {
    heads = await fetchMerged(
      config.vendorAuth,
      config.vendorProject,
      branches
    );
  } catch (err: unknown) {
    logError('fetchMergedBranches', err);
    heads = new Map();
  }
  const merged = new Set(heads.keys());
  if (isCancelled()) return { merged, nextWarned: keepWarned };
  onMerged?.(merged);
  if (!config.autoDeleteOnMerge) {
    return { merged, nextWarned: keepWarned };
  }

  const rebasingNow = await autoDeleteMerged({
    merged: heads,
    onAutoDelete,
    isCancelled,
    cwd,
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
