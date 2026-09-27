import {
  branchTip,
  canRemoveBranch,
  listWorktrees,
  removeWorktree,
  deleteBranch,
} from '@n10/worktree-manager';
import { rescanSessionDiscovery } from '../discovery/session-discovery.js';
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
 * question, render their own prompt from the answer, and hand the
 * answer back to {@link removeWorktreeSession} once confirmed.
 */
export type WorktreeRemovalCheck =
  /** Nothing would be lost. */
  (
    | { verdict: 'clear' }
    /** Git has nothing to lose, but a live agent would be killed. */
    | { verdict: 'agent-running' }
    /** Work on disk would be lost; removal needs `force`. */
    | { verdict: 'force'; reason: string }
    /** n10 does not remove this worktree at all. */
    | { verdict: 'refused'; reason: string }
  ) & {
    /** The branch's commit when it was judged; null if it has none. */
    tip: string | null;
  };

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
  const cwd = cwdFor(repo);
  // Read first: a commit that lands during the checks below then reads
  // as a moved branch, never as one the verdict covered.
  const tip = await branchTip(branch, cwd);
  const check = await canRemoveBranch(branch, { cwd });
  if (!check.safe) {
    return OVERRIDABLE.has(check.reason)
      ? { verdict: 'force', reason: check.reason, tip }
      : { verdict: 'refused', reason: check.reason, tip };
  }
  const key = await sessionKeyFor(branch, cwd);
  return key && isSessionAlive(key)
    ? { verdict: 'agent-running', tip }
    : { verdict: 'clear', tip };
}

/** Remove `branch`'s worktree and the branch, as `approved` allows:
 *  the verdict the user confirmed, at the commit it was judged at. Only
 *  a `force` verdict forces, so files written since the check keep the
 *  worktree. A branch that has moved since keeps everything, since its
 *  new commits were never judged; resolves false then.
 *
 *  Stops the agent in the checkout first. The session belongs to the
 *  checkout, so it is found by the worktree's path — never by the
 *  branch it was created for, which another worktree may have checked
 *  out since.
 *
 *  Resolves once session discovery has seen the result, so the shells
 *  learn of this removal the way they learn of one made outside n10.
 *  Discovery reports only the removal of a worktree it has seen, and a
 *  worktree made moments ago may not have had a scan yet — so it looks
 *  once before the removal as well as after. */
export async function removeWorktreeSession(
  branch: string,
  approved: WorktreeRemovalCheck,
  repo?: string
): Promise<boolean> {
  if (approved.verdict === 'refused') return false;
  const cwd = cwdFor(repo);
  const unmoved = async () => (await branchTip(branch, cwd)) === approved.tip;
  await rescanSessionDiscovery();
  if (!(await unmoved())) return false;
  const key = await sessionKeyFor(branch, cwd);
  if (key) stopSession(key);
  const force = approved.verdict === 'force';
  const removed = await removeWorktree(branch, { force, cwd });
  // The agent could commit until it stopped. The checkout is gone
  // either way, but commits nobody judged keep the branch.
  if (removed && (await unmoved())) await deleteBranch(branch, true, cwd);
  await rescanSessionDiscovery();
  return removed;
}
