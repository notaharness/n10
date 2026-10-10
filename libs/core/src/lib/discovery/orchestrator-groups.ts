import { registryNameOf, type TaggedSession } from '../session-identity.js';
import { listOurSessions } from '../session-resolver.js';

/**
 * Which sessions are Orchestra orchestrators, and which report to each.
 *
 * A player's `@orchestra-orchestrator` is where its reports go:
 * `tmux:<session>`, which names a session on its server, or
 * `claude:<id>` / `codex:<thread>`, which name a conversation. A
 * conversation's session is the one whose `@orchestra-target` carries
 * that same string: Orchestra writes it on the session it runs in when
 * it spawns or adopts a player from inside tmux, and takes it off every
 * other session of that server, so one server has one per target.
 * Nothing else is consulted. A target no session here answers to has
 * no orchestrator here (one outside tmux, one on another machine — a
 * `beam:` target — or a session since closed), and its player stands
 * on its own. Repositories play no part: a player may work in any.
 * A session marked with a target is an orchestrator with or without
 * players: it spawned some, and may again.
 */
export interface OrchestratorGroup {
  orchestrator: OrchestraMember;
  /** In listing order. */
  players: OrchestraMember[];
}

/** One session of a group, by the identities its tab can carry. */
export interface OrchestraMember {
  /** Its registry key (`registryNameOf`). */
  key: string;
  /** `@orchestra-repo`. */
  repo: string;
  /** A worktree session's checkout (`@orchestra-worktree-path`); `''`
   *  for a terminal. */
  worktree: string;
}

const member = (session: TaggedSession): OrchestraMember => ({
  key: registryNameOf(session),
  repo: session.repo,
  worktree: session.worktreePath,
});

/** Group one server's listing: every marked orchestrator in listing
 *  order, then each one players name by `tmux:`, in the order its
 *  first player was listed. */
export function orchestratorGroups(
  sessions: readonly TaggedSession[]
): OrchestratorGroup[] {
  const homes = new Map<string, TaggedSession>();
  const groups = new Map<TaggedSession, OrchestraMember[]>();
  for (const session of sessions) {
    if (session.target.kind === 'tmux')
      homes.set(`tmux:${session.target.name}`, session);
    if (!session.orchestraTarget) continue;
    homes.set(session.orchestraTarget, session);
    groups.set(session, []);
  }
  for (const player of sessions) {
    const home = player.orchestrator && homes.get(player.orchestrator);
    if (!home || home === player) continue;
    const players = groups.get(home) ?? [];
    players.push(member(player));
    groups.set(home, players);
  }
  return [...groups].map(([home, players]) => ({
    orchestrator: member(home),
    players,
  }));
}

/** This machine's tmux server, grouped. Never throws: no server is no
 *  groups. */
export function listOrchestratorGroups(): OrchestratorGroup[] {
  return orchestratorGroups(listOurSessions());
}
