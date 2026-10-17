import {
  BABYSIT_IDLE_MS,
  idleFor,
  isSessionAlive,
  deliverToRunningSession,
  launchSession,
  worktreeSessionKey,
  sessionKeyForBranch,
} from '@n10/core';
import type { BabysitHold } from '@n10/core';
import type { AppConfig, PullRequestInfo } from '@n10/vcs-core';
import {
  checkoutWorktree,
  refExists,
  worktreeScope,
  type WorktreeScope,
} from '@n10/worktree-manager';
import type { PrBabysitterOptions } from './babysit-types.js';

type Delivery =
  | { outcome: 'injected' | 'spawned' }
  | { outcome: 'held'; held: BabysitHold }
  | { outcome: 'failed'; error: string };

/** Whether the branch can be checked out in `cwd` at all — locally, or
 *  from origin. The checkout below refuses to invent a branch, so this
 *  is what turns a missing one into a hold the badge can explain. */
async function branchAvailable(branch: string, cwd: string): Promise<boolean> {
  return (await refExists(branch, cwd)) || refExists(`origin/${branch}`, cwd);
}

/** Type the update into the live session, if it has been quiet. */
function injectIntoLive(
  opts: PrBabysitterOptions,
  name: string,
  prompt: string
): Delivery {
  if (idleFor(name) < (opts.idleMs ?? BABYSIT_IDLE_MS)) {
    return { outcome: 'held', held: 'agent-busy' };
  }
  return deliverToRunningSession(name, prompt)
    ? { outcome: 'injected' }
    : { outcome: 'failed', error: 'The agent exited while being briefed' };
}

/**
 * Start an agent in the worktree with the update as its opening
 * prompt. Babysitting is opt-in per pull request, and an agent that
 * exits between updates is the normal case, so the next update starts
 * one rather than waiting for the user to notice.
 */
async function spawnForUpdate(
  opts: PrBabysitterOptions,
  pr: PullRequestInfo,
  prompt: string,
  live: () => boolean,
  captured: { config: AppConfig; scope: WorktreeScope }
): Promise<Delivery> {
  if (!(await branchAvailable(pr.sourceBranch, opts.cwd))) {
    return { outcome: 'held', held: 'branch-unavailable' };
  }
  if (!live()) return { outcome: 'held', held: 'interrupted' };
  // Checkout only: a `createWorktree` that falls back to `-b` would
  // invent a branch of this name off HEAD and start an agent on the
  // wrong base.
  const worktree = await checkoutWorktree(pr.sourceBranch, captured.scope);
  if (!worktree) {
    return { outcome: 'failed', error: 'Could not create the worktree' };
  }
  // The checkout took time; the repository may have changed under it,
  // or the watch been stopped. A spawn now would run in the wrong
  // repository's terms.
  if (!live()) return { outcome: 'held', held: 'interrupted' };
  const { config } = captured;
  const { cols, rows } = opts.paneSize();
  // `seed`, never `continue-or-seed`: continuing a prior conversation
  // takes the prompt only when there is nothing to continue, and an
  // agent that already worked on this pull request is the normal case.
  const name = worktreeSessionKey(worktree, opts.cwd);
  await launchSession({
    name,
    cwd: worktree,
    branch: pr.sourceBranch,
    cols,
    rows,
    config,
    request: { intent: 'seed', prompt },
  });
  opts.onSpawned?.(name, worktree);
  return { outcome: 'spawned' };
}

/** Hand the update to the agent: typed into its session when one is
 *  running, or as the opening prompt of a new one. */
export async function deliver(
  opts: PrBabysitterOptions,
  pr: PullRequestInfo,
  prompt: string,
  live: () => boolean
): Promise<Delivery> {
  const config = opts.getConfig();
  const scope = worktreeScope(opts.cwd, { template: config.worktreePath });
  const name = await sessionKeyForBranch(pr.sourceBranch, scope);
  if (!live()) return { outcome: 'held', held: 'interrupted' };
  if (name && opts.isForeignSession?.(name)) {
    return { outcome: 'held', held: 'foreign-session' };
  }
  if (name && isSessionAlive(name)) return injectIntoLive(opts, name, prompt);
  return spawnForUpdate(opts, pr, prompt, live, { config, scope });
}
