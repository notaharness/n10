import { spawn } from 'node:child_process';
import { readResourceValue } from '@n10/engine';
import type { WorktreeRemovalCheck } from '@n10/core';
import {
  activeConfigService,
  activeWorktreeService,
  repository,
} from './repo.js';

async function read() {
  const snapshot = await activeWorktreeService().read();
  if (snapshot.error) throw new Error(snapshot.error);
  return snapshot;
}

export async function listWorktrees() {
  return (await read()).worktrees;
}
export async function listBranches() {
  return (await read()).branches;
}
export async function listAllBranches() {
  return (await read()).allBranches;
}
export function createWorktree(branch: string) {
  return activeWorktreeService().create(branch);
}
export function removeWorktree(branch: string, approved: WorktreeRemovalCheck) {
  return activeWorktreeService().remove(branch, approved);
}
export function checkWorktreeRemoval(branch: string) {
  return activeWorktreeService().checkRemoval(branch);
}

/**
 * Live diff of a branch's worktree against its base, including work the
 * agent has not committed. Empty when the branch has no worktree —
 * there is no working tree to look at, and the caller falls back to the
 * commit-range diff.
 */
export async function getWorktreeDiffText(
  repo: string,
  branch: string,
  targetBranch: string
): Promise<string> {
  return readResourceValue(
    repository(repo).reviews.diff.worktree(branch, targetBranch)
  );
}

/** Open the branch's worktree in the configured editor — the TUI's
 *  Shift+E: `config.editor || $VISUAL || $EDITOR`, spawned detached.
 *  createWorktree is idempotent, so PR rows without a checkout work. */
export async function openInEditor(branch: string): Promise<{
  editor: string;
}> {
  const service = activeWorktreeService();
  const { config } = activeConfigService().getSnapshot();
  const editor = config.editor || process.env.VISUAL || process.env.EDITOR;
  if (!editor) throw new Error('No editor configured — set one in Settings');
  const path = await service.create(branch);
  spawn(editor, [path], { detached: true, stdio: 'ignore' }).unref();
  return { editor };
}
