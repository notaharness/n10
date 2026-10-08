import { registryNameOf, type TaggedSession } from '../session-identity.js';
import { listOurSessions } from '../session-resolver.js';

/**
 * Which sessions are Orchestra orchestrators, and which report to each.
 *
 * A player's `@orchestra-orchestrator` is where its reports go:
 * `tmux:<session>`, which names a session on the player's machine, or
 * `claude:<id>` / `codex:<thread>`, which name a conversation. A
 * conversation's session is the one whose `@orchestra-target` carries
 * that same string — Orchestra writes it on its own session when it
 * spawns or adopts a player from inside tmux. Under `beam:<peerId>/`
 * the target lives on that machine. Nothing else is consulted: a
 * target no listed session answers to has no orchestrator here (one
 * outside tmux, on a machine not listed, or in a session since closed),
 * and its player stands on its own. A session marked with a target is
 * an orchestrator with or without players: it spawned some, and may
 * again.
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

const BEAM = /^beam:([0-9a-f]{32})\/(.+)$/;

/** Machine and local target as one lookup key. */
const address = (machine: string, target: string): string =>
  JSON.stringify([machine, target]);

/** Where a player reports to, as an {@link address}. */
function reportsTo(player: TaggedSession): string | null {
  const target = player.orchestrator;
  if (!target) return null;
  const beam = BEAM.exec(target);
  return beam ? address(beam[1]!, beam[2]!) : address(player.machine, target);
}

/** Every address a session answers to: its name as a `tmux:` target,
 *  and the target it was marked with. Two sessions marked with one
 *  target — a conversation resumed in another tab — resolve to the one
 *  created last. */
function homes(sessions: readonly TaggedSession[]): Map<string, TaggedSession> {
  const found = new Map<string, TaggedSession>();
  const claim = (key: string, session: TaggedSession): void => {
    const held = found.get(key);
    if (!held || session.created > held.created) found.set(key, session);
  };
  for (const session of sessions) {
    claim(address(session.machine, `tmux:${session.name}`), session);
    if (session.target)
      claim(address(session.machine, session.target), session);
  }
  return found;
}

/** Group a listing: every marked orchestrator in listing order, then
 *  each orchestrator a player names by name, in the order its first
 *  player was listed. */
export function orchestratorGroups(
  sessions: readonly TaggedSession[]
): OrchestratorGroup[] {
  const byAddress = homes(sessions);
  const groups = new Map<TaggedSession, OrchestraMember[]>();
  for (const session of sessions) {
    const marked = session.target && address(session.machine, session.target);
    if (marked && byAddress.get(marked) === session) groups.set(session, []);
  }
  for (const player of sessions) {
    const to = reportsTo(player);
    const home = to === null ? undefined : byAddress.get(to);
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
