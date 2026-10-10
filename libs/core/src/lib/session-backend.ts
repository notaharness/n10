/** tmux availability and discovery policy shared by both applications. */
import {
  canonicalWorktreePath,
  LOCAL_MACHINE,
  terminalSessionKey,
  sessionIdentity,
} from './session-key.js';
import { isTmuxAvailable, type TmuxStatus } from '@n10/terminal-tmux';
import type {
  DiscoveredTerminal,
  DiscoveredWorktree,
} from './discovery/discovery-model.js';
import { requireMachine } from './machine-registry.js';
import { getSession, liveSessionNames } from './pty-registry.js';
import { localCatalog, selectLocalCatalog } from './session-catalog.js';
import { tmuxCatalog } from './tmux-catalog.js';
import { ManagedCatalog } from './managed-catalog.js';
import { listenMux, type MuxOwner } from './mux/mux-ipc.js';
import { muxRuntime } from './mux/mux-endpoint.js';
import type { OwnerType } from './mux/mux-protocol.js';
import { serveMuxConnection } from './mux/mux-server.js';
import { MuxSessions } from './mux/mux-sessions.js';
import {
  isTerminalSession,
  registryNameOf,
  type TaggedSession,
} from './session-identity.js';
import {
  listOurSessionsWith,
  readOurSessions,
  resolveRegistrySession,
  resolveSessionByName,
} from './session-resolver.js';

export { getRepoRoot, resetRepoRoot } from './repo-root.js';

// ── Tmux availability cache ─────────────────────────────────────
//
// The Settings UI guard runs synchronously inside an Ink input
// handler, so it can't await a Promise. We probe tmux once at
// startup and stash the result here for the handler to read.

let cachedTmuxStatus: TmuxStatus | null = null;

/** Run the tmux availability probe and cache the result. Call once
 *  at startup. Subsequent calls re-await the same memoized
 *  Promise from `@n10/terminal-tmux`'s `isTmuxAvailable()`. */
export async function probeTmuxAvailability(): Promise<void> {
  cachedTmuxStatus = await isTmuxAvailable();
}

/** Synchronously read the cached tmux status. Returns `null` if the
 *  probe hasn't completed yet (extremely unlikely after the first
 *  render — startup awaits it). */
export function getTmuxAvailability(): TmuxStatus | null {
  return cachedTmuxStatus;
}

let owned: { catalog: ManagedCatalog; owner: MuxOwner } | null = null;

/**
 * Choose where this machine's sessions live: tmux when it is installed,
 * else this process becomes the profile's managed owner, whose sessions
 * end with it. A tmux that is installed but fails is an error, never a
 * reason to switch. Until another n10 can attach to a running owner,
 * one that finds the owner already taken refuses to start.
 */
export async function applySessionBackend(ownerType: OwnerType): Promise<void> {
  const status = cachedTmuxStatus;
  if (status?.available) {
    selectLocalCatalog(tmuxCatalog);
    return;
  }
  if (!status?.missing)
    throw new Error(
      `n10 requires tmux 3.2 or newer. ${
        status?.reason ?? 'Availability has not been checked.'
      } ${status?.installHint ?? 'Install tmux and restart n10.'}`
    );
  const claim = await ownSessions(ownerType);
  if (claim.kind === 'existing')
    throw new Error(
      'Another n10 is already running without tmux. Close it, or install tmux to run both.'
    );
}

/**
 * Become the profile's managed owner: claim its mux endpoint, hold its
 * sessions in a `ManagedCatalog`, and answer one-shot mux clients from
 * it. `existing` names the owner already running, which is left alone.
 */
export async function ownSessions(
  ownerType: OwnerType
): Promise<
  { kind: 'owner'; hostId: string } | { kind: 'existing'; hostId: string }
> {
  const runtime = muxRuntime();
  let sessions: MuxSessions | null = null;
  const claim = await listenMux(runtime, (connection) => {
    if (sessions) serveMuxConnection(connection, sessions);
    else connection.socket.end();
  });
  if (claim.kind === 'existing') return claim;
  const catalog = new ManagedCatalog(claim.owner.hostId, runtime.dir);
  sessions = new MuxSessions(catalog, ownerType);
  owned = { catalog, owner: claim.owner };
  selectLocalCatalog(catalog);
  return { kind: 'owner', hostId: claim.owner.hostId };
}

/** Stop the sessions this process owns and give up ownership. tmux
 *  sessions are not this process's: they keep running. */
export function closeSessionBackend(): void {
  if (!owned) return;
  const { catalog, owner } = owned;
  owned = null;
  catalog.close();
  void owner.close();
}

/** What one catalog listing says about the sessions n10 cares about. */
export interface SessionObservation {
  /** The registry names of the asked-about worktrees that have a live
   *  session tagged with this repository and their checkout. */
  persisted: Set<string>;
  /** Every terminal-tab session on the server, whatever directory or
   *  repository it belongs to, plus this repository's orphaned worktree
   *  sessions — see {@link observeSessions}. */
  terminals: DiscoveredTerminal[];
  /** The registry names of every worktree session of this repository
   *  the catalog still has, its process running or exited, whether or not git
   *  still lists the checkout. */
  held: Set<string>;
}

/**
 * One fork, two answers: which worktree sessions survived, and which
 * terminal sessions exist.
 *
 * Every session is read through the resolver, so only tagged sessions
 * are seen at all: a session whose name n10 might have chosen but
 * that carries no tags is foreign and never listed. A worktree session
 * is this repository's when its `@orchestra-repo` is the open root;
 * it is *persisted* when one of the worktrees handed in is the
 * checkout it belongs to (`TaggedSession.worktreePath`), whichever
 * branch that checkout is on now. Another checkout's sessions carry
 * that checkout's root and are left alone.
 *
 * Terminal sessions are found by session type and reported wherever
 * they run, because a terminal belongs to its directory, not to the
 * repository this scan happens to be for — one opened in another
 * checkout still has to come back as a tab. Its directory is the
 * catalog's own (tmux's `session_path`); nothing is written to disk to
 * remember it.
 *
 * A worktree session tagged with this repository whose checkout no
 * worktree answers to — its directory was removed, or its tag names a
 * path git no longer lists — is an orphan, and is reported as an agent
 * terminal in its directory, so it surfaces as a tab instead of running
 * on invisibly. It is never matched to a worktree by its branch: that
 * branch may be checked out in another worktree now, which would hand
 * that worktree this session's agent. Only when nothing here already
 * holds it, though, since attaching a second client to a session this
 * process is driving is exactly what the orphan path must not do.
 * Never throws. An absent tmux server yields nothing, same as no
 * sessions; a listing the catalog could not give (a failed fork, the
 * timeout kill) yields `null`, which says nothing about any session.
 */
export function observeSessions(
  root: string,
  worktrees: readonly DiscoveredWorktree[]
): SessionObservation | null {
  const listed = readOurSessions();
  if (!listed) return null;
  const ctx: ClassifyContext = {
    root,
    byPath: new Map(
      worktrees.map((wt) => [canonicalWorktreePath(wt.path), wt.name])
    ),
    owned: new Set(liveSessionNames()),
  };
  const persisted = new Set<string>();
  const terminals: DiscoveredTerminal[] = [];
  const held = new Set<string>();
  for (const session of listed) {
    if (session.type === 'worktree' && session.repo === root)
      held.add(registryNameOf(session));
    const found = classifySession(session, ctx);
    if (!found) continue;
    if (found.kind === 'terminal') terminals.push(found.terminal);
    else persisted.add(found.name);
  }
  return { persisted, terminals, held };
}

interface ClassifyContext {
  /** The open repository's root — what `@orchestra-repo` must equal. */
  root: string;
  /** Canonical checkout path → the registry name of that worktree. */
  byPath: Map<string, string>;
  /** Registry keys of every session this process already holds — see
   *  {@link liveSessionNames}. */
  owned: Set<string>;
}

/** What one of our live sessions means to this repository: a
 *  worktree session that survived (`persisted`), a terminal tab to
 *  report (`terminal`), or nothing (`null`) — another repository's
 *  session, or one already owned that would otherwise read as an
 *  orphan. A terminal tab needs somewhere to run and display, so a
 *  session the catalog reports no path for is dropped rather than reported
 *  onto no path at all; a persisted worktree session needs no path. */
function classifySession(
  session: TaggedSession,
  ctx: ClassifyContext
):
  | { kind: 'terminal'; terminal: DiscoveredTerminal }
  | { kind: 'persisted'; name: string }
  | null {
  const { path } = session;
  if (isTerminalSession(session)) {
    return path
      ? {
          kind: 'terminal',
          terminal: discoveredTerminal(session, session.type),
        }
      : null;
  }
  if (session.repo !== ctx.root) return null;
  const registryName = ctx.byPath.get(
    canonicalWorktreePath(session.worktreePath)
  );
  if (registryName !== undefined)
    return session.exited ? null : { kind: 'persisted', name: registryName };
  if (ctx.owned.has(registryNameOf(session)) || !path) return null;
  return { kind: 'terminal', terminal: discoveredTerminal(session, 'agent') };
}

/** A session as the terminal tab it comes back as, keyed on the machine
 *  it was listed on. */
function discoveredTerminal(
  session: TaggedSession,
  kind: DiscoveredTerminal['kind']
): DiscoveredTerminal {
  return {
    name: terminalSessionKey(session.target.name, session.machine),
    target: session.target,
    kind,
    path: session.path,
    running: !session.exited,
    agent: session.agent,
    tags: session.tags,
  };
}

/**
 * Every terminal-tab session on another machine, from one listing
 * through its executor: `shell` and `agent` sessions (Orchestra's `dir`
 * included), whichever machine's n10 or Orchestra started them, keyed
 * with the machine they run on. The tags say what a session is, not who
 * listed it. That machine's worktree sessions are left out: their
 * checkouts are its own, not this repository's.
 *
 * Rejects when the machine cannot be asked — no transport, a listing
 * that failed or timed out — which says nothing about its sessions.
 */
export async function observeRemoteTerminals(
  machineId: string
): Promise<DiscoveredTerminal[]> {
  const sessions = await listOurSessionsWith(
    requireMachine(machineId).executor,
    machineId
  );
  return sessions.flatMap((session) =>
    isTerminalSession(session) && session.path
      ? [discoveredTerminal(session, session.type)]
      : []
  );
}

/** The session a registry name stands for in the open
 *  repository, verified by its tags, or `null` — outside a working
 *  tree there is nothing to tag a session with, so nothing to find. */
function resolveOwn(sessionName: string): TaggedSession | null {
  const identity = sessionIdentity(sessionName);
  return identity?.kind === 'worktree'
    ? resolveRegistrySession(identity.repo, sessionName)
    : null;
}

/** Whether the tagged worktree session has a live hosted process. */
export function hasLiveSession(sessionName: string): boolean {
  const session = resolveOwn(sessionName);
  return session !== null && !session.exited;
}

/** Resolve a qualified terminal key to its exact tagged target, across
 *  repositories. Adopted orphan worktrees also use terminal keys. Another
 *  machine's tmux cannot be asked synchronously: its backend's last
 *  listing there answers, which says `gone` once tmux no longer has it. */
export function hasPersistedTerminalSession(name: string): boolean {
  const identity = sessionIdentity(name);
  if (identity?.kind !== 'terminal') return false;
  if (identity.machine !== LOCAL_MACHINE) {
    const state = getSession(name)?.pty.processState;
    return !!state && !state.gone;
  }
  return resolveSessionByName(identity.id) !== null;
}

/** Stop the tagged worktree session even when no local connection exists.
 * Names alone never authorize cleanup: the resolver verifies identity first. */
export function killPersistedSession(sessionName: string): void {
  const session = resolveOwn(sessionName);
  if (session) localCatalog().kill(session.target);
}
