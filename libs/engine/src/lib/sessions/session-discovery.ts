import { watch, type FSWatcher } from 'node:fs';
import { log, logError } from '@n10/logger';
import { listWorktrees, type WorktreeScope } from '@n10/worktree-manager';
import {
  keyForWorktree,
  sessionIdentity,
  hasSessionConnection,
  isSessionAlive,
  sessionNames,
  observeTmuxSessions,
  diffScans,
  type DiscoveredTerminal,
  type DiscoveredWorktree,
  type DiscoveryDelta,
  type DiscoveryScan,
} from '@n10/core';

/** Two batch listings per scan; measured cost and alternatives: docs/decisions.md. */
const DISCOVERY_INTERVAL_MS = 4_000;

/** Coalesce the directory events from one worktree operation. */
const WATCH_DEBOUNCE_MS = 200;

/** Survive transient index.lock failures without retrying deterministic spawn errors forever. */
const MAX_ADOPT_ATTEMPTS = 3;

/** Offers alone are not changes: an adoption can lose a race without changing
 * anything a shell could display. `delta.changed` would refetch every such tick. */
function worthAnnouncing(delta: DiscoveryDelta, adopted: number): boolean {
  return (
    adopted > 0 ||
    delta.appeared.length > 0 ||
    delta.disappeared.length > 0 ||
    delta.switched.length > 0 ||
    delta.ended.length > 0 ||
    delta.endedTerminals.length > 0
  );
}

export interface SessionDiscoveryOptions {
  repo: string;
  scope(): WorktreeScope;
  intervalMs?: number;
  adopt: (worktree: DiscoveredWorktree) => void | Promise<void>;
  adoptTerminal?: (terminal: DiscoveredTerminal) => void | Promise<void>;
  onChanged: (delta: DiscoveryDelta) => void;
  /** Abandon work between awaits when selection changes, before attaching a stale repo's sessions. */
  isCurrent?: () => boolean;
}

export interface SessionDiscovery {
  scanNow(): Promise<void>;
  stop(): void;
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

  let previous: DiscoveryScan | null = null;
  const failures = new Map<string, number>();
  const retired = new Set<string>();
  let stopped = false;
  let tail: Promise<void> = Promise.resolve();
  let pending: Promise<void> | null = null;
  let watcher: FSWatcher | null = null;
  let watchedBase: string | null = null;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;

  async function observe(): Promise<DiscoveryScan> {
    const worktrees: DiscoveredWorktree[] = (
      await listWorktrees(opts.scope())
    ).map((wt) => ({
      name: keyForWorktree(wt, repo),
      branch: wt.branch,
      path: wt.path,
    }));
    const seen = observeTmuxSessions(repo, worktrees);
    return {
      worktrees,
      persisted: seen.persisted,
      terminals: adoptTerminal ? seen.terminals : [],
    };
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
    const next = await observe();
    if (stopped || !isCurrent()) return;
    forgetFailuresFor(next);
    const delta = diffScans(
      previous,
      next,
      (name) => isSessionAlive(name) && hasSessionConnection(name),
      retired,
      hasSessionConnection
    );
    // A repo switch starts a fresh scanner, but terminal tabs are process-global.
    // Reconcile held terminal keys too, including final frames from an earlier scan.
    if (adoptTerminal) {
      const present = new Set(next.terminals.map((terminal) => terminal.name));
      delta.endedTerminals = [
        ...new Set([
          ...delta.endedTerminals,
          ...sessionNames().filter(
            (name) =>
              sessionIdentity(name)?.kind === 'terminal' && !present.has(name)
          ),
        ]),
      ];
    }
    previous = next;
    // Attach first, announce second: the shell answers `changed` by
    // re-reading the registry, and it must see the sessions this scan
    // just adopted rather than the state from before them.
    const adopted = await adoptAll(delta);
    if (worthAnnouncing(delta, adopted) && !stopped && isCurrent()) {
      onChanged(delta);
    }
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

  const timer = setInterval(() => void scanNow(), intervalMs);
  // Never a reason to hold the process open: discovery is something the
  // app does while it is running, not work that has to finish.
  timer.unref?.();
  ensureWatch();
  void scanNow();

  const handle: SessionDiscovery = {
    scanNow,
    stop() {
      stopped = true;
      clearInterval(timer);
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = null;
      watcher?.close();
      watcher = null;
    },
  };
  return handle;
}
