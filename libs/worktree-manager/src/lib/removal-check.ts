/**
 * What deleting a branch and its worktree would cost. The protected
 * branches and a rebase in progress are refused outright; everything
 * else that would be lost is a risk the user may choose to take.
 */
import { existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { log } from '@n10/logger';
import { exec, gitOptions } from './exec.js';
import { refuseRemote, type Machine } from './machine.js';
import { assertShellSafeRef } from './refs.js';
import { worktreeDir } from './worktree-resolver.js';
import { listWorktrees } from './worktree-list.js';

/** Work that removal loses. `git worktree remove` needs `--force` for
 *  uncommitted changes and submodules; unpushed commits go with
 *  `git branch -D`. */
export type RemovalRisk =
  | 'uncommitted changes'
  /** Git could not say whether the checkout has uncommitted changes. */
  | 'unknown changes'
  | 'not pushed to upstream'
  | 'submodules';

export interface BranchRemovalAssessment {
  /** Why removal is refused whatever the user says, if it is. */
  refusal: 'protected branch' | 'rebase in progress' | null;
  /** Every risk that applies, not just the first: each one is work the
   *  user is agreeing to lose. */
  risks: RemovalRisk[];
}

function isProtectedBranch(branch: string): boolean {
  return (
    branch === 'main' || branch === 'master' || branch.startsWith('gitbutler')
  );
}

/**
 * Assess deleting `branch` and its worktree, in `cwd`'s repository (the
 * process's directory when omitted). `confirmedMerged` skips the
 * unpushed check: the provider has vouched for the commits.
 */
export async function assessBranchRemoval(
  branch: string,
  {
    confirmedMerged = false,
    cwd,
    machine,
  }: { confirmedMerged?: boolean; cwd?: string; machine?: Machine } = {}
): Promise<BranchRemovalAssessment> {
  refuseRemote('canRemoveBranch', machine);
  assertShellSafeRef(branch);
  if (isProtectedBranch(branch)) {
    return { refusal: 'protected branch', risks: [] };
  }

  const wt = (await listWorktrees(cwd)).find((w) => w.branch === branch);

  // A mid-rebase worktree carries in-progress rebase state (recovered
  // from rebase-merge/rebase-apply) that force-removing the worktree
  // would silently destroy. Refuse to delete it — auto-delete and manual
  // delete both gate on this — so the user finishes or aborts the rebase
  // first.
  if (wt?.state === 'rebasing') {
    return { refusal: 'rebase in progress', risks: [] };
  }

  // Use the worktree's real path from git so the status check runs
  // against the actual checkout, not a resolver-derived guess that may
  // not exist (which would silently skip the uncommitted-changes guard).
  const dir = wt?.path ?? resolverDir(branch, cwd);
  const risks: RemovalRisk[] = [];
  const changes = await uncommittedChanges(dir, branch, wt !== undefined);
  if (changes) risks.push(changes);
  if (!confirmedMerged && (await hasUnpushedCommits(branch, cwd))) {
    risks.push('not pushed to upstream');
  }
  if (await hasSubmodules(dir, branch)) risks.push('submodules');
  return { refusal: null, risks };
}

/** Where the resolver would put `branch`'s checkout in the repository
 *  at `cwd`: a relative resolver path is that repository's, not the
 *  process's. */
function resolverDir(branch: string, cwd?: string): string {
  return resolve(cwd ?? process.cwd(), worktreeDir(branch));
}

/**
 * Check whether a branch can be safely deleted, in `cwd`'s repository
 * (the process's directory when omitted).
 * Returns { safe: true } or { safe: false, reason } with the refusal or
 * the first risk.
 */
export async function canRemoveBranch(
  branch: string,
  opts: { confirmedMerged?: boolean; cwd?: string; machine?: Machine } = {}
): Promise<{ safe: true } | { safe: false; reason: string }> {
  const { refusal, risks } = await assessBranchRemoval(branch, opts);
  const reason = refusal ?? risks[0];
  return reason ? { safe: false, reason } : { safe: true };
}

/**
 * What the checkout at `dir` has uncommitted, as a risk. Every change
 * counts, untracked files included, whatever the repository's
 * `status.*` settings show, and the whole answer is read. A checkout
 * git cannot answer for is `unknown changes`: only force takes it.
 * Without one there is nothing to lose.
 */
async function uncommittedChanges(
  dir: string,
  branch: string,
  isCheckout: boolean
): Promise<RemovalRisk | null> {
  try {
    const { stdout } = await exec(
      `git -C "${dir}" status --porcelain -z --untracked-files=all --ignore-submodules=none`,
      { encoding: 'utf8', maxBuffer: Infinity }
    );
    return stdout.length > 0 ? 'uncommitted changes' : null;
  } catch (e) {
    log('warn', 'canRemoveBranch', `status check failed for ${branch}`, e);
    return isCheckout ? 'unknown changes' : null;
  }
}

/** The repository `dir` belongs to, as its common git directory: the
 *  same for every checkout of one repository, and different for a
 *  clone. Null when git cannot tell. */
export async function repositoryOf(dir: string): Promise<string | null> {
  try {
    const { stdout } = await exec(
      `git -C "${dir}" rev-parse --path-format=absolute --git-common-dir`,
      { encoding: 'utf8' }
    );
    return realpathSync(stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Whether `branch` holds commits no remote has. As above, a failure
 * answers "no" — the branch may just have no remote tracking.
 */
async function hasUnpushedCommits(
  branch: string,
  cwd?: string
): Promise<boolean> {
  try {
    const { stdout } = await exec(
      `git log "${branch}" --not --remotes -1`,
      gitOptions(cwd)
    );
    return stdout.trim().length > 0;
  } catch (e) {
    log('warn', 'canRemoveBranch', `unpushed check failed for ${branch}`, e);
    return false;
  }
}

/**
 * Whether git will refuse to remove the checkout at `dir` for its
 * submodules without `--force`, which also takes any work inside them.
 * The same test git makes (`validate_no_submodules`): the worktree's
 * own `modules` directory exists, or a gitlink in its index has a
 * checkout. A failure answers "no", as above; git then refuses the
 * unforced removal itself.
 */
async function hasSubmodules(dir: string, branch: string): Promise<boolean> {
  try {
    const { stdout: modules } = await exec(
      `git -C "${dir}" rev-parse --path-format=absolute --git-path modules`,
      { encoding: 'utf8' }
    );
    if (existsSync(modules.trim())) return true;
    // Gitlinks only: the whole index would overflow exec's buffer in a
    // large repository.
    const { stdout: gitlinks } = await exec(
      `git -C "${dir}" ls-files --stage | grep '^160000' || true`,
      { encoding: 'utf8' }
    );
    return gitlinks
      .split('\n')
      .map((line) => line.slice(line.indexOf('\t') + 1))
      .some((path) => path && existsSync(join(dir, path, '.git')));
  } catch (e) {
    log('warn', 'canRemoveBranch', `submodule check failed for ${branch}`, e);
    return false;
  }
}
