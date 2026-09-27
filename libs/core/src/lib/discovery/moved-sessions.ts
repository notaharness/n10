import { existsSync } from 'node:fs';
import { log } from '@n10/logger';
import { tmuxPaneCurrentPath, tmuxSetOptions } from '@n10/terminal-tmux';
import { liveSessionNames } from '../pty-registry.js';
import { canonicalWorktreePath, LOCAL_MACHINE } from '../session-key.js';
import {
  ORCHESTRA_TAG,
  registryNameOf,
  type TaggedSession,
} from '../session-identity.js';

/**
 * Rebinding a worktree session to its checkout after the checkout moved.
 *
 * A worktree session belongs to the checkout its tags name. Moving the
 * repository (and running `git worktree repair`), or `git worktree
 * move`, leaves them naming a directory that is gone: the session then
 * belongs to no worktree, and its running agent reads as stopped next to
 * a row that invites launching a second one.
 *
 * The tags are rewritten only on the kernel's word. tmux reads the pane
 * process's working directory (`#{pane_current_path}`) from the kernel,
 * which follows a directory through a rename. A session is rebound to a
 * checkout when all of these hold:
 *
 * - the checkout its tags name no longer exists;
 * - its pane process is live and runs in exactly the root of a checkout
 *   Git lists for the open repository;
 * - no other session's tags claim that checkout;
 * - this process holds no connection to it under its old key.
 *
 * The branch and the label are never consulted: another checkout can
 * have the session's branch. A checkout that was copied rather than
 * moved is a new directory no process runs in, so it stays a new
 * checkout, and so does one whose agent changed directory. A move while
 * n10 holds the session is recovered by reopening the repository.
 */
export interface MovedSessionDeps {
  exists?: (path: string) => boolean;
  paneCwd?: (tmuxName: string) => string;
  /** Write the tags; `false` when tmux refused. */
  retag?: (tmuxName: string, tags: Record<string, string>) => boolean;
  /** Registry keys this process holds a connection under. */
  held?: () => Iterable<string>;
}

/** What {@link movedCheckout} decides against. */
interface MoveContext {
  /** Canonical path of each listed checkout. */
  listed: Set<string>;
  /** Canonical checkout path of every worktree session's tags. */
  claimed: Set<string>;
  held: Set<string>;
  exists: (path: string) => boolean;
  paneCwd: (tmuxName: string) => string;
}

/**
 * Rebind every session whose checkout moved to one of `worktrees` in
 * `repoRoot`, and return `sessions` as the tags now read. Only a stale
 * session costs a tmux fork. Never throws.
 */
export function rebindMovedSessions(
  sessions: readonly TaggedSession[],
  repoRoot: string,
  worktrees: readonly { path: string }[],
  deps: MovedSessionDeps = {}
): TaggedSession[] {
  const retag = deps.retag ?? defaultRetag;
  const ctx: MoveContext = {
    listed: new Set(worktrees.map((wt) => canonicalWorktreePath(wt.path))),
    claimed: new Set(
      sessions
        .filter((s) => s.type === 'worktree')
        .map((s) => canonicalWorktreePath(s.worktreePath, s.machine))
    ),
    held: new Set((deps.held ?? liveSessionNames)()),
    exists: deps.exists ?? existsSync,
    paneCwd: deps.paneCwd ?? tmuxPaneCurrentPath,
  };
  return sessions.map((session) => {
    const checkout = movedCheckout(session, ctx);
    if (!checkout) return session;
    const tags = {
      [ORCHESTRA_TAG.worktreePath]: checkout,
      [ORCHESTRA_TAG.repo]: repoRoot,
    };
    if (!retag(session.name, tags)) return session;
    ctx.claimed.add(checkout);
    log(
      'info',
      'discovery',
      `rebound ${session.name} from ${session.worktreePath} to ${checkout}`
    );
    return { ...session, repo: repoRoot, worktreePath: checkout };
  });
}

/** The listed checkout `session`'s agent moved into with its
 *  directory, or `null`. */
function movedCheckout(
  session: TaggedSession,
  ctx: MoveContext
): string | null {
  if (
    session.type !== 'worktree' ||
    session.machine !== LOCAL_MACHINE ||
    session.paneDead ||
    ctx.exists(session.worktreePath) ||
    ctx.held.has(registryNameOf(session))
  )
    return null;
  const cwd = ctx.paneCwd(session.name);
  if (!cwd) return null;
  const checkout = canonicalWorktreePath(cwd);
  return ctx.listed.has(checkout) && !ctx.claimed.has(checkout)
    ? checkout
    : null;
}

function defaultRetag(tmuxName: string, tags: Record<string, string>): boolean {
  return tmuxSetOptions(tmuxName, tags).exitCode === 0;
}
