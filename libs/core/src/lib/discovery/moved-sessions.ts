import { existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { log } from '@n10/logger';
import { tmuxPaneCurrentPath, tmuxSetOptions } from '@n10/terminal-tmux';
import { canonicalWorktreePath, LOCAL_MACHINE } from '../session-key.js';
import {
  ORCHESTRA_TAG,
  registryNameOf,
  type TaggedSession,
} from '../session-identity.js';

/**
 * Rebinding a worktree session after its repository moved.
 *
 * A worktree session belongs to the checkout its tags name. Renaming
 * the repository (then `git worktree repair`) leaves them naming a
 * directory that is gone: the session belongs to no worktree, and its
 * running agent reads as stopped next to a row that invites launching
 * a second one.
 *
 * The tags are rewritten only when two independent facts agree:
 *
 * - Structure: the repository the tags name no longer exists, and the
 *   open repository lists a checkout at the same path relative to its
 *   root as the tagged checkout had relative to the old one.
 * - Kernel: tmux reports that exact checkout root as the pane's current
 *   path (`#{pane_current_path}`: the working directory of the pane's
 *   foreground process, which follows a directory through a rename).
 *
 * The session must also be live and local, the checkout unclaimed by
 * any other session's tags, the match unambiguous (one stale session
 * per checkout), and this process must hold no connection to it under
 * its old key. The branch and the label are never consulted. A copied
 * repository is new directories no process runs in; a deleted one
 * leaves the pane in a `(deleted)` path; an agent whose foreground job
 * is elsewhere gives no evidence. Each stays unbound.
 */
export interface MovedSessionDeps {
  exists?: (path: string) => boolean;
  paneCwd?: (tmuxName: string) => string;
  /** Write the tags; `false` when tmux refused. */
  retag?: (tmuxName: string, tags: Record<string, string>) => boolean;
}

/**
 * Rebind every session whose repository moved to `repoRoot`, and
 * return `sessions` as the tags now read. `held` is the registry keys
 * this process holds a connection under. Only a session that passes
 * the structural check costs a tmux fork. Never throws.
 */
export function rebindMovedSessions(
  sessions: readonly TaggedSession[],
  repoRoot: string,
  worktrees: readonly { path: string }[],
  held: Iterable<string>,
  deps: MovedSessionDeps = {}
): TaggedSession[] {
  const paneCwd = deps.paneCwd ?? tmuxPaneCurrentPath;
  const retag = deps.retag ?? defaultRetag;
  const candidates = relocationCandidates(sessions, repoRoot, worktrees, {
    held: new Set(held),
    exists: deps.exists ?? existsSync,
  });
  const rebound = new Map<string, string>();
  for (const [checkout, [session, ...others]] of candidates) {
    if (others.length > 0 || paneCwd(session.name) !== checkout) continue;
    const tags = {
      [ORCHESTRA_TAG.worktreePath]: checkout,
      [ORCHESTRA_TAG.repo]: repoRoot,
    };
    if (!retag(session.name, tags)) continue;
    rebound.set(session.name, checkout);
    log(
      'info',
      'discovery',
      `rebound ${session.name} from ${session.worktreePath} to ${checkout}`
    );
  }
  return sessions.map((session) => {
    const checkout = rebound.get(session.name);
    return checkout
      ? { ...session, repo: repoRoot, worktreePath: checkout }
      : session;
  });
}

/** Stale sessions by the listed, unclaimed checkout their moved
 *  repository puts them in — structure only, no tmux. */
function relocationCandidates(
  sessions: readonly TaggedSession[],
  repoRoot: string,
  worktrees: readonly { path: string }[],
  ctx: { held: Set<string>; exists: (path: string) => boolean }
): Map<string, TaggedSession[]> {
  const listed = new Set(worktrees.map((wt) => canonicalWorktreePath(wt.path)));
  const claimed = new Set(
    sessions
      .filter((s) => s.type === 'worktree')
      .map((s) => canonicalWorktreePath(s.worktreePath, s.machine))
  );
  const candidates = new Map<string, TaggedSession[]>();
  for (const session of sessions) {
    const checkout = relocatedCheckout(session, repoRoot, ctx.exists);
    if (!checkout || !listed.has(checkout) || claimed.has(checkout)) continue;
    if (ctx.held.has(registryNameOf(session))) continue;
    candidates.set(checkout, [...(candidates.get(checkout) ?? []), session]);
  }
  return candidates;
}

/** Where `session`'s checkout sits in `repoRoot` if its repository
 *  moved there, or `null` when it is not a live local worktree session
 *  whose repository and checkout are gone. */
function relocatedCheckout(
  session: TaggedSession,
  repoRoot: string,
  exists: (path: string) => boolean
): string | null {
  if (
    session.type !== 'worktree' ||
    session.machine !== LOCAL_MACHINE ||
    session.paneDead ||
    exists(session.repo) ||
    exists(session.worktreePath)
  )
    return null;
  const inRepo = relative(session.repo, session.worktreePath);
  if (!inRepo || inRepo.startsWith('..') || isAbsolute(inRepo)) return null;
  return canonicalWorktreePath(join(repoRoot, inRepo));
}

function defaultRetag(tmuxName: string, tags: Record<string, string>): boolean {
  return tmuxSetOptions(tmuxName, tags).exitCode === 0;
}
