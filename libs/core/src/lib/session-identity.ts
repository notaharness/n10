import {
  canonicalWorktreePath,
  worktreeSessionKey,
  terminalSessionKey,
} from './session-key.js';

/**
 * What a tmux session *is*, and what it is merely *called*.
 *
 * Names are labels, tags are identity. A session's name is chosen once
 * at creation, for a human reading `tmux ls` (`session-label.ts`), and
 * never parsed: every lookup — attach, exists, kill, adopt, list — goes
 * through the session user options ("tags") of the shared tmux
 * agent-session convention, which both n10 and Orchestra write on the
 * sessions they create and read on each other's: the core record
 * ({@link SESSION_KEY}) and vendor extensions (`@session-x-<vendor>-*`).
 * A session without them is foreign: never attached to, killed, adopted
 * or listed, whatever it is called and whatever other tags it carries.
 * This file owns every tag name; `session-identity-read.ts` reads them
 * and `session-identity-write.ts` writes them.
 *
 * Tags: `set-option -t '=<name>:' @key value` to write, `#{@key}` in a
 * format string to read. They die with the session and need no file.
 * A value is a single-line string; an absent tag is unset, never empty
 * or a sentinel.
 */

/** The convention's core record. Only version, agent and launcher are
 *  required; n10 neither publishes nor reads the status keys yet, and
 *  only clears them when it replaces an agent. */
export const SESSION_KEY = {
  /** `1`, written last: a record without it is not participating. */
  version: '@session-version',
  /** The harness token (`claude`, `codex`, …). */
  agent: '@session-agent',
  /** `n10` or `orchestra`: the tool that registered the session. */
  launcher: '@session-launcher',
  /** The native ID (`%N`) of the pane the agent runs in. */
  pane: '@session-pane',
  /** The canonical primary working directory. */
  cwd: '@session-cwd',
  /** A worktree session's canonical checkout: its identity. */
  worktree: '@session-worktree',
  /** A worktree session's canonical main checkout. */
  repo: '@session-repo',
  status: '@session-status',
  statusKind: '@session-status-kind',
  statusAt: '@session-status-at',
} as const;

/** The convention's schema major n10 reads and writes. */
export const SESSION_VERSION = '1';

/** n10's extensions; their contract is the tag table in
 *  `docs/decisions.md`. */
export const N10_EXT = {
  /** `worktree`, `shell` or `agent`. */
  sessionType: '@session-x-n10-session-type',
  /** Worktree sessions: the branch the session was created for,
   *  unsanitized (`feature/x`); a detached-HEAD worktree's directory
   *  name. Written once, as task context — the worktree may since have
   *  switched to another branch, so it never says which checkout the
   *  session belongs to. */
  branch: '@session-x-n10-branch',
  /** Terminal tabs: the directory the tab was opened in. */
  dir: '@session-x-n10-dir',
} as const;

/** The Orchestra extensions n10 reads or clears; their contract is
 *  Orchestra's. */
export const ORCHESTRA_EXT = {
  /** Worktree players: the branch the player was spawned for. */
  branch: '@session-x-orchestra-branch',
  /** The player's reporting target — `tmux:<session>`, `codex:<thread>`
   *  or `claude:<session id>`, optionally under `beam:<peerId>/`. */
  orchestrator: '@session-x-orchestra-orchestrator',
  /** A local `claude:` target's Claude config directory, which stays
   *  out of the target string. n10 only clears it, with the target. */
  orchestratorConfig: '@session-x-orchestra-orchestrator-config',
  /** `<KIND> <ISO-8601 UTC> <OUTCOME>` of the last delivered report.
   *  Not agent status. */
  lastReport: '@session-x-orchestra-last-report',
  /** On an orchestrator's own session: the `claude:` or `codex:` target
   *  its players carry as their orchestrator, which names a
   *  conversation, not a session. Never beam-qualified. */
  target: '@session-x-orchestra-target',
  /** `1` while `@session-agent` is only Orchestra's guess (a resume
   *  that has not found its harness yet). n10 then treats the agent as
   *  unknown. */
  agentProvisional: '@session-x-orchestra-agent-provisional',
} as const;

/** Every tag a listing asks tmux for, in the one fork. */
export const LISTED_TAGS: readonly string[] = [
  SESSION_KEY.version,
  SESSION_KEY.agent,
  SESSION_KEY.launcher,
  SESSION_KEY.cwd,
  SESSION_KEY.worktree,
  SESSION_KEY.repo,
  ...Object.values(N10_EXT),
  ORCHESTRA_EXT.branch,
  ORCHESTRA_EXT.orchestrator,
  ORCHESTRA_EXT.lastReport,
  ORCHESTRA_EXT.target,
  ORCHESTRA_EXT.agentProvisional,
];

/** What n10 writes as `@session-launcher`. */
export const N10_SPAWNER = 'n10';

/**
 * - `worktree`: an agent bound to one git worktree (n10's worktree
 *   sessions, Orchestra's players). Identity = (repo, worktree path).
 * - `shell` / `agent`: a n10 terminal tab — the user's shell, or an
 *   agent CLI not bound to a worktree — or an Orchestra `dir` player.
 *   Identity = the name, which is unique on the server and stable for
 *   the session's life.
 */
export type SessionType = 'worktree' | 'shell' | 'agent';

/** One of our sessions, as the tags describe it. */
export interface TaggedSession {
  /** The tmux name — a label, never parsed. */
  name: string;
  /** Optional title of the session's primary pane at discovery time. */
  paneTitle?: string;
  /** `#{session_created}`, epoch seconds: orders two sessions that
   *  claim one identity. */
  created: number;
  paneDead: boolean;
  exitCode?: number;
  /** `#{session_path}` — the directory the session runs in. */
  path: string;
  spawner: string;
  /** A worktree session's main checkout; a terminal's directory. */
  repo: string;
  type: SessionType;
  /** Set on `worktree` sessions; `''` when the tag is missing. The
   *  branch it was created for, not necessarily the one checked out. */
  branch: string;
  /** `worktree` sessions: the checkout it belongs to; `''` for a
   *  terminal. It holds even when it names a directory that is gone:
   *  such a session belongs to no worktree, and is never re-associated
   *  by its branch. */
  worktreePath: string;
  agent?: string;
  orchestrator?: string;
  lastReport?: string;
  /** Set on an orchestrator's own session — see `ORCHESTRA_EXT.target`. */
  target?: string;
  /** The tags the session was identified by, as read (`''` when
   *  unset): what replacing its process guards. */
  identityTags: Readonly<Record<string, string>>;
  /** The machine this session lives on — a beam `peerId`, or `'local'`.
   *  Set by whoever listed the session: the local resolver always says
   *  `'local'`; a remote poller (D3) stamps its peerId. Tags themselves
   *  carry no machine — `@session-repo` holds the path as it exists on
   *  this machine, whichever one that is. */
  machine: string;
}

/** The worktree session for a repository and checkout: string
 *  equality on the symlink-resolved repo path and on the canonical
 *  worktree path. The branch is not consulted — the checkout may have
 *  switched to another since, and another worktree may have the
 *  session's branch checked out now. */
export function isWorktreeSessionFor(
  session: TaggedSession,
  repoRoot: string,
  worktreePath: string
): boolean {
  return (
    session.type === 'worktree' &&
    session.repo === repoRoot &&
    !!session.worktreePath &&
    canonicalWorktreePath(session.worktreePath, session.machine) ===
      canonicalWorktreePath(worktreePath, session.machine)
  );
}

/** A terminal tab (`shell` or `agent`). */
export function isTerminalSession(
  session: TaggedSession
): session is TaggedSession & { type: 'shell' | 'agent' } {
  return session.type === 'shell' || session.type === 'agent';
}

/**
 * The PTY-registry key a session answers to in its own repository:
 * a worktree session is keyed by `worktreeSessionKey(path)`, the
 * checkout it belongs to and the key both shells spawn it under; a terminal tab by its tmux name,
 * which discovery learns from the listing.
 */
export function registryNameOf(session: TaggedSession): string {
  return session.type === 'worktree'
    ? worktreeSessionKey(session.worktreePath, session.repo, session.machine)
    : terminalSessionKey(session.name, session.machine);
}
