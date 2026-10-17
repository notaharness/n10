/**
 * Git worktree lifecycle: creating a checkout for a branch, removing
 * one, deciding whether removal is safe, and rebasing one onto main.
 *
 * Each operation receives an immutable repository and path scope.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '@n10/logger';
import { exec, gitOptions } from './exec.js';
import {
  isRemoteMachine,
  refuseRemote,
  runGitOn,
  type Machine,
} from './machine.js';
import { assertShellSafeRef } from './refs.js';
import type { WorktreeScope } from './worktree-resolver.js';
import {
  listWorktreeRegistrations,
  listWorktrees,
  type WorktreeInfo,
} from './worktree-list.js';
import { clearDeletedWorktrees } from './deleted-worktrees.js';
import { getMainBranch } from './branches.js';

/**
 * Resolve the actual on-disk path of the worktree that has `branch`
 * checked out, by asking git rather than deriving it from the branch
 * name. A worktree's directory is independent of its branch name (git
 * lets you `worktree add <any-dir> <branch>`, and n10's resolver only
 * governs the dirs *it* creates), so the resolver-derived path can be
 * wrong for externally-created worktrees.
 *
 * Uses `listWorktrees` rather than the raw porcelain so a mid-rebase
 * worktree — which reports a detached HEAD with no `branch` line — still
 * matches via its recovered branch, and so the result is scoped to
 * n10-owned worktrees. Returns `null` if no owned worktree currently
 * has the branch checked out.
 */
async function worktreeForBranch(
  branch: string,
  scope: WorktreeScope
): Promise<WorktreeInfo | null> {
  const wt = (await listWorktrees(scope)).find((w) => w.branch === branch);
  return wt ?? null;
}

async function worktreePathForBranch(
  branch: string,
  scope: WorktreeScope
): Promise<string | null> {
  return (await worktreeForBranch(branch, scope))?.path ?? null;
}

/**
 * Create a git worktree for a branch.
 * If the branch exists, checks it out. If not, creates a new branch from HEAD.
 * Returns the worktree path on success, null on failure.
 *
 * The scope is local by default. A remote machine (D5) runs the same
 * two-step git sequence through its executor instead of a local fork —
 * see {@link createWorktreeRemote} for what that path cannot do that
 * the local one can.
 */
export async function createWorktree(
  branch: string,
  scope: WorktreeScope
): Promise<string | null> {
  const { cwd, machine, resolver } = scope;
  assertShellSafeRef(branch);
  const relativeDir = resolver.dir(branch);
  const absoluteDir = resolve(cwd, relativeDir);
  if (isRemoteMachine(machine))
    return createWorktreeRemote(
      branch,
      scope,
      relativeDir,
      absoluteDir,
      machine
    );

  const { present, deleted } = await listWorktreeRegistrations(scope);
  const existing = present.find((w) => w.branch === branch);
  if (existing) return existing.path;
  // A derived directory may belong to another branch. Never run an agent there.
  if (existsSync(absoluteDir)) return null;
  await clearDeletedWorktrees(deleted, branch, absoluteDir, cwd);

  try {
    // Try existing branch first
    await exec(
      `git worktree add "${relativeDir}" "${branch}"`,
      gitOptions(cwd)
    );
    return absoluteDir;
  } catch (e) {
    log(
      'warn',
      'createWorktree',
      `existing branch checkout failed for ${branch}`,
      e
    );
    try {
      // Branch doesn't exist — create new branch from HEAD
      await exec(
        `git worktree add -b "${branch}" "${relativeDir}"`,
        gitOptions(cwd)
      );
      return absoluteDir;
    } catch (e2) {
      log(
        'error',
        'createWorktree',
        `new branch creation failed for ${branch}`,
        e2
      );
      return null;
    }
  }
}

/**
 * The remote twin of {@link createWorktree}'s two-step sequence, run
 * through `machine`'s executor. There is no filesystem on this side to
 * `existsSync` check against the remote directory before creating —
 * that guard is the git call's to make: `git worktree add` refuses an
 * occupied directory on its own, loudly, which is exactly what should
 * happen instead of a silent local fallback.
 */
async function createWorktreeRemote(
  branch: string,
  scope: WorktreeScope,
  relativeDir: string,
  absoluteDir: string,
  machine: Machine
): Promise<string | null> {
  const { cwd } = scope;
  const existingPath = await worktreePathForBranch(branch, scope);
  if (existingPath) return existingPath;
  try {
    await runGitOn(machine, ['worktree', 'add', relativeDir, branch], cwd);
    return absoluteDir;
  } catch (e) {
    log(
      'warn',
      'createWorktree',
      `remote existing-branch checkout failed for ${branch} on ${machine.id}`,
      e
    );
    try {
      await runGitOn(
        machine,
        ['worktree', 'add', '-b', branch, relativeDir],
        cwd
      );
      return absoluteDir;
    } catch (e2) {
      log(
        'error',
        'createWorktree',
        `remote new-branch creation failed for ${branch} on ${machine.id}`,
        e2
      );
      return null;
    }
  }
}

/**
 * Check out a branch that already exists — locally, or on exactly one
 * remote, which git resolves to a tracking branch of the same name —
 * into its worktree, and return the path. Null when git refused,
 * which includes the branch not existing at all: unlike
 * {@link createWorktree}, this never invents a branch of that name
 * off HEAD. For a caller acting on a branch it did not choose (a pull
 * request's source branch), a new branch would put an agent to work
 * on the wrong base.
 *
 * The scope captures the repository and path policy for both resolution and Git.
 */
export async function checkoutWorktree(
  branch: string,
  scope: WorktreeScope
): Promise<string | null> {
  const { cwd, machine, resolver } = scope;
  refuseRemote('checkoutWorktree', machine);
  assertShellSafeRef(branch);
  const relativeDir = resolver.dir(branch);
  const absoluteDir = resolve(cwd, relativeDir);

  // As in `createWorktree`: a worktree's directory is independent of
  // its branch name, so the path above only finds the ones n10 made
  // under the current template. Asking git — about `cwd`'s repository,
  // not the process's, since a caller here may outlive a change of
  // directory — is what stops a branch that is already checked out
  // somewhere from reading as "no worktree, and git refused to make
  // one", which for a babysitter means silently doing nothing.
  const { present, deleted } = await listWorktreeRegistrations(scope);
  const existing = present.find((w) => w.branch === branch);
  if (existing) return existing.path;
  if (existsSync(absoluteDir)) return null;
  await clearDeletedWorktrees(deleted, branch, absoluteDir, cwd);

  try {
    await exec(
      `git worktree add "${relativeDir}" "${branch}"`,
      gitOptions(cwd)
    );
    return absoluteDir;
  } catch (e) {
    log('error', 'checkoutWorktree', `checkout failed for ${branch}`, e);
    return null;
  }
}

/**
 * Remove a git worktree for a branch.
 * Returns true on success, false on failure.
 *
 * The scope is local by default. A remote machine (D5) removes the
 * worktree through its executor instead of a local fork — the
 * function this package's AGENTS.md exists to warn about: running
 * locally when the caller asked for a remote machine would delete the
 * wrong work, so this never falls back silently.
 */
export async function removeWorktree(
  branch: string,
  scope: WorktreeScope,
  { force = false }: { force?: boolean } = {}
): Promise<boolean> {
  const { cwd, machine } = scope;
  assertShellSafeRef(branch);
  // Resolve the actual checkout from Git; never remove a guessed directory.
  const target = await worktreePathForBranch(branch, scope);
  if (!target) return false;
  assertShellSafeRef(target, 'worktree path');
  const removeArgs = [
    'worktree',
    'remove',
    ...(force ? ['--force'] : []),
    target,
  ];
  if (isRemoteMachine(machine)) {
    try {
      await runGitOn(machine, removeArgs, cwd);
      return true;
    } catch (e) {
      log(
        'error',
        'removeWorktree',
        `remote git worktree remove failed for ${branch} on ${machine.id}`,
        e
      );
      return false;
    }
  }
  try {
    const forceFlag = force ? ' --force' : '';
    await exec(`git worktree remove${forceFlag} "${target}"`, gitOptions(cwd));
    return true;
  } catch (e) {
    log(
      'error',
      'removeWorktree',
      `git worktree remove failed for ${branch}`,
      e
    );
    return false;
  }
}

/**
 * Fetch origin's main branch and rebase the worktree's branch onto it.
 * If conflicts arise, the rebase is automatically aborted.
 */
export async function rebaseOntoMaster(
  worktreePath: string,
  machine?: Machine
): Promise<'success' | 'conflict' | 'error'> {
  refuseRemote('rebaseOntoMaster', machine);
  assertShellSafeRef(worktreePath, 'worktree path');
  const main = await getMainBranch(worktreePath);
  try {
    await exec(`git -C "${worktreePath}" fetch origin ${main}`, {
      encoding: 'utf8',
    });
  } catch (e) {
    log('error', 'rebaseOntoMaster', `fetch origin ${main} failed`, e);
    return 'error';
  }
  try {
    await exec(`git -C "${worktreePath}" rebase origin/${main}`, {
      encoding: 'utf8',
    });
    return 'success';
  } catch (e) {
    log('warn', 'rebaseOntoMaster', 'rebase failed, aborting', e);
    try {
      await exec(`git -C "${worktreePath}" rebase --abort`, {
        encoding: 'utf8',
      });
    } catch (e2) {
      log('error', 'rebaseOntoMaster', 'rebase --abort failed', e2);
    }
    return 'conflict';
  }
}
