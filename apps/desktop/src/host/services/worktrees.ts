import {
  checkWorktreeRemoval as checkRemoval,
  removeWorktreeSession,
  type WorktreeRemovalCheck,
  type WorktreeRemovalOutcome,
} from '@n10/core';
import {
  listWorktrees as listWts,
  listBranches as listBr,
  listAllBranches as listAllBr,
  createWorktree as createWt,
} from '@n10/worktree-manager';
import { spawn } from 'node:child_process';
import { fetchWorktreeDiffText } from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { activeRepoIs, requireRepo } from './repo.js';
import { startBabysit, stopBabysitForBranch } from './babysit.js';

// All worktree-manager functions resolve paths against process.cwd();
// openRepo() chdir'd into the active repo, so these are repo-scoped.

export function listWorktrees() {
  requireRepo();
  return listWts();
}

export function listBranches() {
  requireRepo();
  return listBr();
}

export function listAllBranches() {
  requireRepo();
  return listAllBr();
}

export async function createWorktree(branch: string): Promise<string> {
  requireRepo();
  const path = await createWt(branch);
  // The resolver answers `null` for anything git refused — an invalid
  // ref name, a branch already checked out elsewhere. Returning that as
  // a success made the renderer's mutation resolve, toast "Worktree
  // ready", and leave the optimistically-opened tab on its loading
  // state forever, because no sidebar item was ever coming. The launch
  // and open-in-editor paths already throw here; this one did not.
  if (!path) {
    throw new Error(`Failed to create a worktree for "${branch}"`);
  }
  return path;
}

export async function removeWorktree(
  branch: string,
  approved: WorktreeRemovalCheck
): Promise<WorktreeRemovalOutcome> {
  const repo = requireRepo();
  const babysat = stopBabysitForBranch(branch);
  const outcome = await removeWorktreeSession(branch, approved, repo);
  const gone = outcome === 'removed' || outcome === 'kept-branch';
  // Nothing was removed, so its agent is still there to watch. A
  // restarted babysitter starts from nothing, as after a restart.
  if (!gone && activeRepoIs(repo)) {
    for (const prId of babysat) {
      await startBabysit(prId).catch((err: unknown) =>
        console.error('[desktop] babysit restart failed:', err)
      );
    }
  }
  return outcome;
}

export function checkWorktreeRemoval(branch: string) {
  return checkRemoval(branch, requireRepo());
}

/**
 * Live diff of a branch's worktree against its base, including work the
 * agent has not committed. Empty when the branch has no worktree —
 * there is no working tree to look at, and the caller falls back to the
 * commit-range diff.
 */
export async function getWorktreeDiffText(
  branch: string,
  targetBranch: string
): Promise<string> {
  requireRepo();
  const wt = (await listWts()).find((w) => w.branch === branch);
  if (!wt) return '';
  return fetchWorktreeDiffText(wt.path, targetBranch);
}

/** Open the branch's worktree in the configured editor — the TUI's
 *  Shift+E: `config.editor || $VISUAL || $EDITOR`, spawned detached.
 *  createWorktree is idempotent, so PR rows without a checkout work. */
export async function openInEditor(branch: string): Promise<{
  editor: string;
}> {
  const cwd = requireRepo();
  const config = readConfig(cwd);
  const editor = config.editor || process.env.VISUAL || process.env.EDITOR;
  if (!editor) {
    throw new Error('No editor configured — set one in Settings');
  }
  const path = await createWt(branch);
  if (!path) {
    throw new Error(`Failed to resolve a worktree for "${branch}"`);
  }
  spawn(editor, [path], { detached: true, stdio: 'ignore' }).unref();
  return { editor };
}
