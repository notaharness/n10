import {
  assessBranchRemoval,
  branchTip,
  listWorktrees,
  removeWorktree,
  deleteBranch,
  repositoryOf,
  type RemovalRisk,
  type WorktreeInfo,
} from '@n10/worktree-manager';
import { rescanSessionDiscovery } from '../discovery/session-discovery.js';
import { isSessionAlive } from '../pty-registry.js';
import { stopSession } from './stop-session.js';
import { getRepoRoot } from '../repo-root.js';
import { canonicalWorktreePath, keyForWorktree } from '../session-key.js';

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
     *  same list for display. `discardsUncommitted` when confirming
     *  runs `--force`, which takes whatever is uncommitted when the
     *  removal runs, not only what the check saw. */
    | {
        verdict: 'force';
        reason: string;
        risks: readonly RemovalRisk[];
        discardsUncommitted: boolean;
      }
    /** n10 does not remove this worktree at all. */
    | { verdict: 'refused'; reason: string }
  ) & {
    /** The branch's commit when it was judged; null if it has none. */
    tip: string | null;
    /** The repository judged, by its common git directory. */
    repo: string | null;
    /** The checkout judged, by its canonical path; null if no checkout
     *  had the branch. */
    checkout: string | null;
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
  'unknown changes',
  'submodules',
]);

/** Whether removing past `risks` needs `--force`. */
function forcesPast(risks: readonly RemovalRisk[]): boolean {
  return risks.some((risk) => FORCED_RISKS.has(risk));
}

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

/** Which repository and checkout a verdict is about, and the tip. */
async function judgedAt(branch: string, cwd: string) {
  const checkout = await checkoutFor(branch, cwd);
  return {
    checkout,
    at: {
      tip: await branchTip(branch, cwd),
      repo: await repositoryOf(cwd),
      checkout: checkout ? canonicalWorktreePath(checkout.path) : null,
    },
  };
}

/** Decide what removing `branch`'s worktree needs from the user. */
export async function checkWorktreeRemoval(
  branch: string,
  repo?: string
): Promise<WorktreeRemovalCheck> {
  const cwd = cwdFor(repo);
  // Read first: a commit that lands during the checks below then reads
  // as a moved branch, never as one the verdict covered.
  const { checkout, at } = await judgedAt(branch, cwd);
  const { refusal, risks } = await assessBranchRemoval(branch, { cwd });
  if (refusal) return { verdict: 'refused', reason: refusal, ...at };
  if (risks.length > 0) {
    const reason = risks.join(', ');
    const discardsUncommitted = forcesPast(risks);
    return { verdict: 'force', reason, risks, discardsUncommitted, ...at };
  }
  return checkout && isSessionAlive(keyForWorktree(checkout, cwd))
    ? { verdict: 'agent-running', ...at }
    : { verdict: 'clear', ...at };
}

/** The verdict the merged-branch sweep removes with: `clear`, at the
 *  tip it judged, for the checkout at `checkoutPath`. */
export async function clearVerdictAt(
  checkoutPath: string,
  tip: string | null
): Promise<WorktreeRemovalCheck> {
  return {
    verdict: 'clear',
    tip,
    repo: await repositoryOf(checkoutPath),
    checkout: canonicalWorktreePath(checkoutPath),
  };
}

/** The checkout that has `branch`, while it is still as `approved`
 *  judged it: the same repository and checkout, the branch at the same
 *  tip, and nothing git guards with `--force` that the verdict did not
 *  name. A rebase leaves the branch
 *  where it was until it finishes, so the tip alone would miss one that
 *  started since; the assessment refuses it. Null when anything changed. */
async function judgedCheckout(
  branch: string,
  approved: WorktreeRemovalCheck,
  cwd: string
): Promise<WorktreeInfo | null> {
  const { checkout, at } = await judgedAt(branch, cwd);
  const same =
    checkout !== null &&
    at.tip === approved.tip &&
    at.repo !== null &&
    at.repo === approved.repo &&
    at.checkout === approved.checkout;
  if (!same) return null;
  const { refusal, risks } = await assessBranchRemoval(branch, {
    cwd,
    confirmedMerged: true,
  });
  const named = approved.verdict === 'force' ? approved.risks : [];
  const unnamed = risks.some((r) => FORCED_RISKS.has(r) && !named.includes(r));
  return refusal || unnamed ? null : checkout;
}

/** Remove `branch`'s worktree and the branch, as `approved` allows:
 *  the verdict the user confirmed, at the commit it was judged at.
 *  `--force` takes only the risks the verdict named that git guards
 *  with it. Anything else found since the check keeps everything,
 *  since nothing done then was judged: a moved branch, a rebase, a
 *  file written into a checkout judged clean. It is looked for before
 *  the agent is stopped and again once it has.
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
  await rescanSessionDiscovery();
  const checkout = await judgedCheckout(branch, approved, cwd);
  if (!checkout) return 'changed';
  stopSession(keyForWorktree(checkout, cwd));
  const outcome = (await judgedCheckout(branch, approved, cwd))
    ? await removeJudged(branch, approved, cwd)
    : 'changed';
  await rescanSessionDiscovery();
  return outcome;
}

/** Remove the worktree and, while the branch is still at the judged
 *  tip, the branch. The agent is stopped by now, but a commit could
 *  still land from outside n10; the checkout goes either way. */
async function removeJudged(
  branch: string,
  approved: WorktreeRemovalCheck,
  cwd: string
): Promise<WorktreeRemovalOutcome> {
  const force = approved.verdict === 'force' && forcesPast(approved.risks);
  if (!(await removeWorktree(branch, { force, cwd }))) return 'git-refused';
  if ((await branchTip(branch, cwd)) !== approved.tip) return 'kept-branch';
  return (await deleteBranch(branch, true, cwd)) ? 'removed' : 'kept-branch';
}
