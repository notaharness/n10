import {
  assessBranchRemoval,
  branchTip,
  listWorktrees,
  removeWorktree,
  deleteBranch,
  type RemovalRisk,
  type WorktreeInfo,
} from '@n10/worktree-manager';
import { rescanSessionDiscovery } from '../discovery/session-discovery.js';
import { isSessionAlive } from '../pty-registry.js';
import { stopSession } from './stop-session.js';
import { getRepoRoot } from '../repo-root.js';
import { keyForWorktree } from '../session-key.js';

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
    /** Work would be lost: every risk that applies, and `reason`, the
     *  same list for display. */
    | { verdict: 'force'; reason: string; risks: readonly RemovalRisk[] }
    /** n10 does not remove this worktree at all. */
    | { verdict: 'refused'; reason: string }
  ) & {
    /** The branch's commit when it was judged; null if it has none. */
    tip: string | null;
  };

/**
 * What {@link removeWorktreeSession} did. Anything but `removed` kept
 * something the user asked to lose, and the shells say why.
 */
export type WorktreeRemovalOutcome =
  /** The worktree and the branch are gone. */
  | 'removed'
  /** The worktree is gone; the branch stays, with commits made before
   *  its agent stopped. */
  | 'kept-branch'
  /** Nothing was removed: the branch moved, or a rebase started, after
   *  the check. */
  | 'changed'
  /** Nothing was removed: git would not remove the worktree. */
  | 'git-refused'
  /** Nothing was removed: the verdict refused it. */
  | 'refused';

/** The risks `git worktree remove` itself refuses without `--force`.
 *  Unpushed commits go with the branch, so they never need it. */
const FORCED_RISKS: ReadonlySet<RemovalRisk> = new Set([
  'uncommitted changes',
  'populated submodules',
]);

function cwdFor(repo: string | undefined): string {
  return repo ?? getRepoRoot() ?? process.cwd();
}

/** The checkout that has `branch`, if any. */
async function checkoutFor(
  branch: string,
  cwd: string
): Promise<WorktreeInfo | null> {
  return (await listWorktrees(cwd)).find((w) => w.branch === branch) ?? null;
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
  const { refusal, risks } = await assessBranchRemoval(branch, { cwd });
  if (refusal) return { verdict: 'refused', reason: refusal, tip };
  if (risks.length > 0) {
    return { verdict: 'force', reason: risks.join(', '), risks, tip };
  }
  const checkout = await checkoutFor(branch, cwd);
  return checkout && isSessionAlive(keyForWorktree(checkout, cwd))
    ? { verdict: 'agent-running', tip }
    : { verdict: 'clear', tip };
}

/** Remove `branch`'s worktree and the branch, as `approved` allows:
 *  the verdict the user confirmed, at the commit it was judged at. Only
 *  the risks git itself guards with `--force` are forced past, so files
 *  written since the check keep the worktree. A branch that has moved
 *  since, or started a rebase, keeps everything: nothing it did then
 *  was judged.
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
): Promise<WorktreeRemovalOutcome> {
  if (approved.verdict === 'refused') return 'refused';
  const cwd = cwdFor(repo);
  const unmoved = async () => (await branchTip(branch, cwd)) === approved.tip;
  await rescanSessionDiscovery();
  const checkout = await checkoutFor(branch, cwd);
  // A rebase leaves the branch where it was until it finishes, so the
  // tip alone would not show one that started after the check.
  if (!(await unmoved()) || checkout?.state === 'rebasing') return 'changed';
  if (checkout) stopSession(keyForWorktree(checkout, cwd));
  const force =
    approved.verdict === 'force' &&
    approved.risks.some((risk) => FORCED_RISKS.has(risk));
  const removed = await removeWorktree(branch, { force, cwd });
  // The agent could commit until it stopped. The checkout is gone
  // either way, but commits nobody judged keep the branch.
  const outcome = !removed
    ? 'git-refused'
    : (await unmoved())
    ? 'removed'
    : 'kept-branch';
  if (outcome === 'removed') await deleteBranch(branch, true, cwd);
  await rescanSessionDiscovery();
  return outcome;
}
