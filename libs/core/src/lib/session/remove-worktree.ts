import {
  canRemoveBranch,
  listWorktrees,
  removeWorktree,
  deleteBranch,
} from '@n10/worktree-manager';
import { isSessionAlive } from '../pty-registry.js';
import { stopSession } from './stop-session.js';
import { getRepoRoot } from '../repo-root.js';
import { keyForWorktree } from '../session-key.js';

/** The unsafe reasons a user may override: the work they lose is on
 *  disk and they can see it. Anything else — a protected branch, a
 *  rebase in progress — is refused outright. */
const OVERRIDABLE = new Set(['uncommitted changes', 'not pushed to upstream']);

/**
 * What removing the worktree that has a branch checked out would cost,
 * and so what the user must confirm first. Both shells ask this one
 * question and render their own prompt from the answer.
 */
export type WorktreeRemovalCheck =
  /** Nothing would be lost. */
  | { verdict: 'clear' }
  /** Git has nothing to lose, but a live agent would be killed. */
  | { verdict: 'agent-running' }
  /** Work on disk would be lost; removal needs `force`. */
  | { verdict: 'force'; reason: string }
  /** n10 does not remove this worktree at all. */
  | { verdict: 'refused'; reason: string };

function cwdFor(repo: string | undefined): string {
  return repo ?? getRepoRoot() ?? process.cwd();
}

/** The session key of the checkout that has `branch`, if any. */
async function sessionKeyFor(
  branch: string,
  cwd: string
): Promise<string | null> {
  const worktree = (await listWorktrees(cwd)).find((w) => w.branch === branch);
  return worktree ? keyForWorktree(worktree, cwd) : null;
}

/** Decide what removing `branch`'s worktree needs from the user. */
export async function checkWorktreeRemoval(
  branch: string,
  repo?: string
): Promise<WorktreeRemovalCheck> {
  const check = await canRemoveBranch(branch);
  if (!check.safe) {
    return OVERRIDABLE.has(check.reason)
      ? { verdict: 'force', reason: check.reason }
      : { verdict: 'refused', reason: check.reason };
  }
  const key = await sessionKeyFor(branch, cwdFor(repo));
  return key && isSessionAlive(key)
    ? { verdict: 'agent-running' }
    : { verdict: 'clear' };
}

/** Stop the agent in the checkout that has `branch`, before deleting
 *  that checkout. The session belongs to the checkout, so it is found by
 *  the worktree's path — never by the branch it was created for, which
 *  another worktree may have checked out since. */
export async function removeWorktreeSession(
  branch: string,
  force: boolean,
  repo?: string
): Promise<boolean> {
  const cwd = cwdFor(repo);
  const key = await sessionKeyFor(branch, cwd);
  if (key) stopSession(key);
  const removed = await removeWorktree(branch, { force, cwd });
  if (removed) await deleteBranch(branch, true, cwd);
  return removed;
}
