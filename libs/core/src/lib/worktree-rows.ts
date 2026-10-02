import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import {
  listWorktrees,
  type WorktreeScope,
  type WorktreeInfo,
} from '@n10/worktree-manager';
import { getSession, sessionNames } from './pty-registry.js';
import {
  keyForWorktree,
  LOCAL_MACHINE,
  sessionIdentity,
} from './session-key.js';
import type { AgentSession } from './types.js';

/**
 * A worktree as a sidebar session row, the same in both shells.
 *
 * The row is keyed by the checkout (`keyForWorktree`), so the agent
 * running there stays the row's across `git switch`, a branch rename
 * or a detached HEAD, and a second worktree on the branch the agent
 * was created for never claims it. `sessionBranch` says when the
 * checkout has moved on from that branch.
 */
export function worktreeSessionRow(
  wt: Pick<WorktreeInfo, 'branch' | 'path' | 'state'>,
  isAlive: (name: string) => boolean,
  repo?: string
): AgentSession {
  const name = keyForWorktree(wt, repo);
  const createdFor = getSession(name)?.createdFor;
  return {
    name,
    label: wt.branch || wt.path.split('/').pop(),
    branch: wt.branch,
    path: wt.path,
    running: isAlive(name),
    ...(wt.state ? { state: wt.state } : {}),
    ...(createdFor && wt.branch && createdFor !== wt.branch
      ? { sessionBranch: createdFor }
      : {}),
  };
}

/**
 * Rows for the agents this process runs in checkouts of `repo` that are
 * gone: the directory was removed (`git worktree remove`, `rm -rf`, n10
 * itself) while the agent ran, and the agent outlived it. Each lasts
 * while `isAlive` says the agent runs, so it can be seen and stopped
 * rather than run on unseen.
 *
 * Judged by the directory, not by a worktree listing: a listing that
 * failed, has not been read yet or follows another path template must
 * not strand every agent it leaves out. A stranded row has no branch:
 * the branch may be checked out in a new worktree by now, and the row
 * must not claim that worktree's pull request or badges. It is labelled
 * with the branch its agent was created for. This machine's only: no
 * directory of another machine is ever looked for here.
 */
export function strandedSessionRows(
  repo: string,
  isAlive: (name: string) => boolean
): AgentSession[] {
  return sessionNames().flatMap((name): AgentSession[] => {
    const identity = sessionIdentity(name);
    if (
      identity?.kind !== 'worktree' ||
      identity.machine !== LOCAL_MACHINE ||
      identity.repo !== repo ||
      !isAlive(name) ||
      existsSync(identity.path)
    )
      return [];
    return [
      {
        name,
        label: getSession(name)?.createdFor || basename(identity.path),
        path: identity.path,
        running: true,
        worktreeRemoved: true,
      },
    ];
  });
}

/**
 * The session key of the checkout that has `branch` checked out, or
 * `null` when none has — for the callers that start from a pull
 * request's branch rather than a worktree. A session is found through
 * its checkout, never by the branch it was created for.
 */
export async function sessionKeyForBranch(
  branch: string,
  scope: WorktreeScope
): Promise<string | null> {
  const worktree = (await listWorktrees(scope)).find(
    (w) => w.branch === branch
  );
  return worktree ? keyForWorktree(worktree, scope.cwd) : null;
}
