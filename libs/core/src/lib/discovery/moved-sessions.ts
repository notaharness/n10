import { existsSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { log } from '@n10/logger';
import { tmuxPanePaths, tmuxSetOptions } from '@n10/terminal-tmux';
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
 * - Kernel: tmux reports that exact checkout root as the current path
 *   of every pane in the session (`#{pane_current_path}`: the working
 *   directory of each pane's foreground process, which follows a
 *   directory through a rename). One pane elsewhere, a split parked
 *   in another clone's checkout, say, refuses the session.
 *
 * The session must also be live and local, the checkout unclaimed by
 * any other session's tags, the match unambiguous (one session with
 * that evidence per checkout), and this process must hold no
 * connection to it under its old key. The branch and the label are
 * never consulted. A copied repository is new directories no process
 * runs in; a deleted one leaves its panes in a `(deleted)` path; an
 * agent whose foreground job is elsewhere gives no evidence. Each
 * stays unbound. What tmux cannot show is a job-control shell whose
 * foreground job moved while its own directory did not.
 */
export interface MovedSessionDeps {
  exists?: (path: string) => boolean;
  /** Every pane's current path in the session. */
  panePaths?: (tmuxName: string) => string[];
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
  const panePaths = deps.panePaths ?? tmuxPanePaths;
  const retag = deps.retag ?? defaultRetag;
  const evidenced = relocationCandidates(sessions, repoRoot, worktrees, {
    held: new Set(held),
    exists: deps.exists ?? existsSync,
  }).filter(({ session, checkout }) => {
    const paths = panePaths(session.name);
    return paths.length > 0 && paths.every((path) => path === checkout);
  });
  const rebound = new Map<string, string>();
  for (const { session, checkout } of evidenced) {
    // Two sessions evidenced into one checkout: either would be a guess.
    if (evidenced.some((c) => c.checkout === checkout && c.session !== session))
      continue;
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

/** Each stale session with the listed, unclaimed checkout its moved
 *  repository puts it in: structure only, no tmux. */
function relocationCandidates(
  sessions: readonly TaggedSession[],
  repoRoot: string,
  worktrees: readonly { path: string }[],
  ctx: { held: Set<string>; exists: (path: string) => boolean }
): { session: TaggedSession; checkout: string }[] {
  const listed = new Set(worktrees.map((wt) => canonicalWorktreePath(wt.path)));
  const claimed = new Set(
    sessions
      .filter((s) => s.type === 'worktree')
      .map((s) => canonicalWorktreePath(s.worktreePath, s.machine))
  );
  return sessions.flatMap((session) => {
    const checkout = relocatedCheckout(session, repoRoot, ctx.exists);
    return checkout &&
      listed.has(checkout) &&
      !claimed.has(checkout) &&
      !ctx.held.has(registryNameOf(session))
      ? [{ session, checkout }]
      : [];
  });
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
