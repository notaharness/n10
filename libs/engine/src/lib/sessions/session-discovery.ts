import { watch, type FSWatcher } from 'node:fs';
import { log, logError } from '@n10/logger';
import { listWorktrees, type WorktreeScope } from '@n10/worktree-manager';
import {
  canonicalWorktreePath,
  keyForWorktree,
  LOCAL_MACHINE,
  sessionIdentity,
  hasSessionConnection,
  isSessionAlive,
  onSessionExit,
  sessionNames,
  stopSession,
  strandedSessionRows,
  observeTmuxSessions,
  releaseExitedSession,
  diffScans,
  type DiscoveredTerminal,
  type DiscoveredWorktree,
  type DiscoveryDelta,
  type DiscoveryScan,
} from '@n10/core';
import {
  endedTerminals,
  heldTerminals,
  observeMachineTerminals,
} from './terminal-discovery.js';

/** Two batch listings per scan; measured cost and alternatives: docs/decisions.md. */
const DISCOVERY_INTERVAL_MS = 4_000;

/** Coalesce the directory events from one worktree operation. */
const WATCH_DEBOUNCE_MS = 200;

/** Survive transient index.lock failures without retrying deterministic spawn errors forever. */
const MAX_ADOPT_ATTEMPTS = 3;

/** Offers alone are not changes: an adoption can lose a race without changing
 * anything a shell could display. `delta.changed` would refetch every such tick.
 * `touched` counts the sessions this scan attached or released. */
function worthAnnouncing(delta: DiscoveryDelta, touched: number): boolean {
  return (
    touched > 0 ||
    delta.appeared.length > 0 ||
    delta.disappeared.length > 0 ||
    delta.stranded.length > 0 ||
    delta.switched.length > 0 ||
    delta.ended.length > 0 ||
    delta.endedTerminals.length > 0
  );
}

/**
 * An agent that outlived its worktree has ended too, so nothing is left
 * to show or restart: end its tmux session, which keeps the dead pane,
 * rather than let the pane come back as an orphan terminal.
 */
function endFinishedStranded(
  previous: DiscoveryScan | null,
  delta: DiscoveryDelta
): void {
  const stranded = new Set(previous?.stranded.map((wt) => wt.name));
  // Never a running agent: only one that has ended leaves nothing to show.
  const finished = delta.disappeared.filter(
    (wt) => stranded.has(wt.name) && !isSessionAlive(wt.name)
  );
  if (finished.length === 0) return;
  for (const wt of finished) stopSession(wt.name);
  const gone = new Set(finished.map((wt) => canonicalWorktreePath(wt.path)));
  delta.adoptableTerminals = delta.adoptableTerminals.filter(
    (t) => !gone.has(canonicalWorktreePath(t.path))
  );
}

export interface SessionDiscoveryOptions {
  repo: string;
  scope(): WorktreeScope;
  intervalMs?: number;
  adopt: (worktree: DiscoveredWorktree) => void | Promise<void>;
  adoptTerminal?: (terminal: DiscoveredTerminal) => void | Promise<void>;
  /** The other machines whose terminals to list beside this machine's:
   *  the beam peerIds the fleet says are connected. */
  remoteMachines?: () => readonly string[];
  onChanged: (delta: DiscoveryDelta) => void;
  /** Abandon work between awaits when selection changes, before attaching a stale repo's sessions. */
  isCurrent?: () => boolean;
  /** What an earlier scanner of this repository last saw (`lastScan()`).
   *  The first scan diffs against it, so a worktree removed while no
   *  scanner watched the repository is reported like any other removal. */
  baseline?: DiscoveryScan | null;
}

export interface SessionDiscovery {
  scanNow(): Promise<void>;
  stop(): void;
  /** What the last finished scan saw, or the baseline before one has. */
  lastScan(): DiscoveryScan | null;
}

export function startSessionDiscovery(
  opts: SessionDiscoveryOptions
): SessionDiscovery {
  const {
    repo,
    adopt,
    adoptTerminal,
    onChanged,
    isCurrent = () => true,
  } = opts;
  const intervalMs = opts.intervalMs ?? DISCOVERY_INTERVAL_MS;

  let previous: DiscoveryScan | null = opts.baseline ?? null;
  const failures = new Map<string, number>();
  const retired = new Set<string>();
  let stopped = false;
  let tail: Promise<void> = Promise.resolve();
  let pending: Promise<void> | null = null;
  let watcher: FSWatcher | null = null;
  let watchedBase: string | null = null;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;

  async function observe(): Promise<{
    scan: DiscoveryScan;
    held: Set<string>;
    listed: Set<string>;
  }> {
    // Never rejects, so nothing is left unhandled if git fails below.
    const remote = observeMachineTerminals(
      adoptTerminal ? opts.remoteMachines?.() ?? [] : []
    );
    const worktrees: DiscoveredWorktree[] = (
      await listWorktrees(opts.scope())
    ).map((wt) => ({
      name: keyForWorktree(wt, repo),
      branch: wt.branch,
      path: wt.path,
    }));
    const seen = observeTmuxSessions(repo, worktrees);
    // As for a failed git listing, the scan is dropped: read as no
    // sessions, it would end every terminal and release every exited
    // agent, and the next scan would not bring them back.
    if (!seen) throw new Error('tmux could not list its sessions');
    // Stays stranded while its agent runs and git does not list it, even
    // if something recreates the directory.
    const listed = new Set(worktrees.map((wt) => wt.name));
    const wasStranded = new Set(previous?.stranded.map((wt) => wt.name));
    const keep = (name: string) => wasStranded.has(name) && !listed.has(name);
    const elsewhere = await remote;
    return {
      scan: {
        worktrees,
        stranded: strandedSessionRows(repo, isSessionAlive, keep).map(
          (row) => ({
            name: row.name,
            branch: '',
            path: row.path ?? '',
          })
        ),
        persisted: seen.persisted,
        terminals: adoptTerminal
          ? [...seen.terminals, ...elsewhere.terminals]
          : [],
      },
      held: seen.held,
      listed: new Set([LOCAL_MACHINE, ...elsewhere.listed]),
    };
  }

  /** An agent that exited with its pane kept stays to be read and
   *  resumed while tmux holds its session. Nothing polls a dead pane, so
   *  only a scan sees the session go (killed, its server ended). */
  function releaseGone(held: Set<string>): number {
    let released = 0;
    for (const name of sessionNames()) {
      const identity = sessionIdentity(name);
      if (
        identity?.kind !== 'worktree' ||
        identity.machine !== LOCAL_MACHINE ||
        identity.repo !== repo ||
        held.has(name) ||
        isSessionAlive(name)
      )
        continue;
      releaseExitedSession(name);
      released += 1;
    }
    return released;
  }

  async function adoptOne<T extends { name: string }>(
    item: T,
    attach: (item: T) => void | Promise<void>
  ): Promise<boolean> {
    // Re-checked here, not once in `diffScans`: an earlier attach in
    // the same loop can take long enough for the user to launch this
    // session themselves, and handing a live one to `spawnSession`
    // disposes the PTY and emulator behind the pane they are looking at.
    if (isSessionAlive(item.name) && hasSessionConnection(item.name))
      return false;
    try {
      await attach(item);
      failures.delete(item.name);
      log('info', 'discovery', `attached external session ${item.name}`);
      return true;
    } catch (err: unknown) {
      const attempts = (failures.get(item.name) ?? 0) + 1;
      failures.set(item.name, attempts);
      if (attempts >= MAX_ADOPT_ATTEMPTS) retired.add(item.name);
      logError('discovery', err);
      return false;
    }
  }

  async function adoptAll(delta: DiscoveryDelta): Promise<number> {
    const offers = [
      ...delta.adoptable.map((wt) => () => adoptOne(wt, adopt)),
      ...delta.adoptableTerminals.map(
        (t) => () => adoptOne(t, adoptTerminal ?? (() => undefined))
      ),
    ];
    let adopted = 0;
    for (const offer of offers) {
      if (stopped || !isCurrent()) return adopted;
      if (await offer()) adopted += 1;
    }
    return adopted;
  }

  function forgetFailuresFor(next: DiscoveryScan): void {
    const live = new Set(next.terminals.map((t) => t.name));
    for (const name of [...failures.keys()]) {
      if (next.persisted.has(name) || live.has(name)) continue;
      failures.delete(name);
      retired.delete(name);
    }
  }

  async function runScan(): Promise<void> {
    if (stopped || !isCurrent()) return;
    const before = heldTerminals();
    const { scan: next, held, listed } = await observe();
    if (stopped || !isCurrent()) return;
    forgetFailuresFor(next);
    const delta = diffScans(
      previous,
      next,
      (name) => isSessionAlive(name) && hasSessionConnection(name),
      retired,
      hasSessionConnection
    );
    const released = releaseGone(held);
    endFinishedStranded(previous, delta);
    // A repo switch starts a fresh scanner, but terminal tabs are process-global.
    // Reconcile held terminal keys too, including final frames from an earlier scan.
    if (adoptTerminal)
      delta.endedTerminals = endedTerminals(delta, next, before, listed);
    // A first scan has nothing to diff against, so it reports no
    // worktree as appeared; a listing the shell read before it may lack
    // one it sees, and nothing else would have the shell look again.
    const first = previous === null && next.worktrees.length > 0;
    previous = next;
    // Attach first, announce second: the shell answers `changed` by
    // re-reading the registry, and it must see the sessions this scan
    // just adopted rather than the state from before them.
    const adopted = await adoptAll(delta);
    const announce = first || worthAnnouncing(delta, adopted + released);
    if (announce && !stopped && isCurrent()) onChanged(delta);
    ensureWatch();
  }

  function scanNow(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    const scan = tail
      .then(() => {
        // Starting now, so it can no longer answer for a later caller.
        pending = null;
        return stopped ? undefined : runScan();
      })
      // A scan runs on a timer with nobody to report to, and an
      // unhandled rejection here would end the process.
      .catch((err: unknown) => logError('discovery', err));
    pending = scan;
    tail = scan;
    return scan;
  }

  function ensureWatch(): void {
    if (stopped) return;
    const base = opts.scope().resolver.base();
    if (watcher && watchedBase === base) return;
    watcher?.close();
    watcher = null;
    watchedBase = base;
    try {
      watcher = watch(base, { persistent: false, recursive: false }, () => {
        if (watchTimer || stopped) return;
        watchTimer = setTimeout(() => {
          watchTimer = null;
          void scanNow();
        }, WATCH_DEBOUNCE_MS);
      });
      // A watch on a directory that is later deleted errors rather than
      // going quiet. Drop it and let the next scan re-establish one.
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      // Nothing to watch yet — no worktree has ever been created here,
      // or the platform will not watch this path. The interval covers
      // it, and every scan tries again.
      watcher = null;
    }
  }

  // A stranded worktree is gone once its agent is: look now rather than
  // at the next tick, so its tab goes when the agent ends.
  const offExit = onSessionExit((name) => {
    if (previous?.stranded.some((wt) => wt.name === name)) void scanNow();
  });

  const timer = setInterval(() => void scanNow(), intervalMs);
  // Never a reason to hold the process open: discovery is something the
  // app does while it is running, not work that has to finish.
  timer.unref?.();
  ensureWatch();
  void scanNow();

  const handle: SessionDiscovery = {
    scanNow,
    lastScan: () => previous,
    stop() {
      stopped = true;
      offExit();
      clearInterval(timer);
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = null;
      watcher?.close();
      watcher = null;
    },
  };
  return handle;
}
