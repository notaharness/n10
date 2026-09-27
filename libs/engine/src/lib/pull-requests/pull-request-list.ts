/**
 * The pull request list: one service, read by both shells.
 *
 * Everything that wants to know what the provider says about a
 * repository's pull requests — the TUI's sidebar, the desktop's
 * sidebar polling every few seconds, a babysitter asking about one row
 * every minute — reads it from here, so the provider is asked once per
 * interval however many readers there are. `prPollInterval` is the
 * TTL, honoured verbatim.
 *
 * **Scoped.** An answer belongs to a repository *and* the provider,
 * project and credentials generation it was fetched under
 * (`pull-request-scope.ts`). Replacing any of those at the same path
 * moves the repository to a new scope with nothing in it, so a list
 * fetched as somebody else is never shown, and a fetch still out under
 * the old scope can land only in the old one. Past `MAX_CACHED_SCOPES`
 * the least recently used idle scope goes.
 *
 * **One request per scope at a time.** Reads join the request already
 * out. A forced read — the user pressed refresh, or the app knows the
 * list moved — may not be answered by a request that predates it, so
 * it queues exactly one fresh request behind the one out, which every
 * forced read meanwhile shares. A slow response therefore can never
 * overwrite a newer one, and a provider is never asked twice at once
 * for the same thing.
 *
 * **A refresh reaches the provider's memo at the right moment.** A
 * provider may hold per-row answers beyond one response (Azure keeps a
 * settled CI verdict for ten minutes). `refresh` tells it to forget
 * when its own request starts, not when it is asked: a request already
 * out would otherwise write its answers straight back.
 *
 * **A read that fails is done.** Serialising requests relies on each
 * one settling; a provider's reads carry their own deadline (the GitHub
 * transport kills a `gh` read at 30s), and the resulting error is a
 * failure like any other.
 *
 * **Failure is remembered too.** A failed read keeps the last good list
 * and exposes the error beside it, and is retried on the interval
 * rather than on every read — a provider that is down does not get a
 * fresh request from every sidebar poll.
 *
 * **Observed, not only awaited.** `getSnapshot` answers from memory
 * with an object that changes identity only when what it describes
 * does; `subscribe` names the repository whose snapshot moved. `watch`
 * keeps a repository fresh on its interval for a frontend with no poll
 * of its own.
 */
import { logError } from '@n10/logger';
import type { PullRequestLookup } from '@n10/core';
import type { AppConfig, BranchPrMap, VcsProvider } from '@n10/vcs-core';
import { createPollSchedule } from './poll-schedule.js';
import {
  providerResolver,
  scopeOf,
  type PullRequestScope,
} from './pull-request-scope.js';

export const PULL_REQUEST_POLL_DEFAULT_MS = 60_000;

/**
 * How many scopes' lists to keep: enough to cover moving between the
 * checkouts one person has open at once — the desktop's tab strip
 * spans repositories, and following a tab opens its repository.
 */
export const MAX_CACHED_SCOPES = 8;

/** No minimum: `prPollInterval` is honoured verbatim. */
export function pullRequestPollIntervalMs(
  interval: number | undefined
): number {
  return interval ?? PULL_REQUEST_POLL_DEFAULT_MS;
}

export interface PullRequestListSnapshot {
  /** The last successful answer for the repository's current scope. */
  readonly prMap: BranchPrMap;
  /** When that answer landed; null before the first. */
  readonly fetchedAt: number | null;
  /** Why the last attempt failed, if it did. `prMap` stays. */
  readonly error: string | null;
  /** A request is out, or queued behind one that is. */
  readonly refreshing: boolean;
}

/** What a repository with no answer yet shows. Stable identity. */
export const EMPTY_PULL_REQUEST_LIST: PullRequestListSnapshot = Object.freeze({
  prMap: Object.freeze({}) as BranchPrMap,
  fetchedAt: null,
  error: null,
  refreshing: false,
});

export interface PullRequestListOptions {
  providers: readonly VcsProvider[];
  /** A repository's config. Defaults to the persisted one. */
  readConfig?: (cwd: string) => AppConfig;
  now?: () => number;
}

export interface PullRequestList {
  /** What the list holds for `cwd` now, without going anywhere. */
  getSnapshot(cwd: string): PullRequestListSnapshot;
  /** Called with a repository whenever its snapshot changes. */
  subscribe(listener: (cwd: string) => void): () => void;
  /** The list, fetched if it is past its TTL. `force` asks for an
   *  answer that postdates the call. Never rejects: a failure serves
   *  the last good list and is reported through the snapshot. */
  read(cwd: string, opts?: { force?: boolean }): Promise<BranchPrMap>;
  /** The user asked: a forced read that also has the provider forget
   *  its per-row answers when the request starts. */
  refresh(cwd: string): Promise<BranchPrMap>;
  /** Start a read if one is due and return without waiting for it. */
  refreshInBackground(cwd: string): void;
  /** Keep `cwd` fresh on its interval until the returned function is
   *  called. */
  watch(cwd: string): () => void;
  /** One pull request as the list has it, read on the list's own
   *  schedule. Absent means merged or closed only when the list is an
   *  answer. */
  lookupPullRequest(cwd: string, prId: number): Promise<PullRequestLookup>;
  /** The credentials changed: every provider forgets what it cached,
   *  and every repository starts a new, empty scope. */
  credentialsChanged(): void;
  /** Requests started, for every repository, since creation. */
  fetchCount(): number;
  /** Stop every watch and drop every listener. */
  dispose(): void;
}

interface Queued {
  promise: Promise<BranchPrMap>;
  /** Some refresh sharing this request asked the provider to forget. */
  forget: boolean;
}

interface Slot {
  scope: PullRequestScope;
  prMap: BranchPrMap;
  fetchedAt: number | null;
  failedAt: number | null;
  error: string | null;
  inflight: Promise<BranchPrMap> | null;
  queued: Queued | null;
  usedAt: number;
  snapshot: PullRequestListSnapshot;
}

const NO_PULL_REQUESTS = EMPTY_PULL_REQUEST_LIST.prMap;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function busy(slot: Slot): boolean {
  return slot.inflight !== null || slot.queued !== null;
}

function snapshotOf(slot: Slot): PullRequestListSnapshot {
  return {
    prMap: slot.prMap,
    fetchedAt: slot.fetchedAt,
    error: slot.error,
    refreshing: busy(slot),
  };
}

function ttlOf(slot: Slot): number {
  return pullRequestPollIntervalMs(slot.scope.config.prPollInterval);
}

/** When the last attempt, successful or not, finished; 0 for never. */
function lastAttempt(slot: Slot): number {
  return Math.max(slot.fetchedAt ?? 0, slot.failedAt ?? 0);
}

export function createPullRequestList(
  options: PullRequestListOptions
): PullRequestList {
  const { providers, now = () => Date.now() } = options;
  const resolve = providerResolver(providers, options.readConfig);
  const slots = new Map<string, Slot>();
  // Which scope each repository was last resolved to: what its
  // snapshot shows.
  const current = new Map<string, string>();
  const listeners = new Set<(cwd: string) => void>();
  let generation = 0;
  let fetches = 0;

  const emit = (cwd: string): void => {
    for (const listener of [...listeners]) listener(cwd);
  };

  const currentSlot = (cwd: string): Slot | undefined => {
    const key = current.get(cwd);
    return key === undefined ? undefined : slots.get(key);
  };

  const getSnapshot = (cwd: string): PullRequestListSnapshot =>
    currentSlot(cwd)?.snapshot ?? EMPTY_PULL_REQUEST_LIST;

  const live = (slot: Slot): boolean => slots.get(slot.scope.key) === slot;

  /** Re-derive a slot's snapshot and tell whoever is looking. */
  const changed = (slot: Slot): void => {
    slot.snapshot = snapshotOf(slot);
    if (currentSlot(slot.scope.cwd) === slot) emit(slot.scope.cwd);
  };

  /** Drop the least recently used idle scopes past the bound. The one
   *  being read is never a candidate. */
  const evict = (keep: Slot): void => {
    while (slots.size > MAX_CACHED_SCOPES) {
      let oldest: Slot | null = null;
      for (const slot of slots.values()) {
        if (slot === keep || busy(slot)) continue;
        if (!oldest || slot.usedAt < oldest.usedAt) oldest = slot;
      }
      if (!oldest) return;
      slots.delete(oldest.scope.key);
      if (current.get(oldest.scope.cwd) === oldest.scope.key) {
        current.delete(oldest.scope.cwd);
      }
    }
  };

  /** The slot for `cwd`'s scope as its config stands now. */
  const slotFor = (cwd: string): Slot => {
    const scope = scopeOf(cwd, resolve(cwd), generation);
    let slot = slots.get(scope.key);
    if (slot) {
      // Same scope, fresher config: an interval edit is seen here.
      slot.scope = scope;
    } else {
      slot = {
        scope,
        prMap: NO_PULL_REQUESTS,
        fetchedAt: null,
        failedAt: null,
        error: null,
        inflight: null,
        queued: null,
        usedAt: now(),
        snapshot: EMPTY_PULL_REQUEST_LIST,
      };
      slots.set(scope.key, slot);
      evict(slot);
    }
    if (current.get(cwd) !== scope.key) {
      current.set(cwd, scope.key);
      emit(cwd);
      schedule.reschedule(cwd);
    }
    return slot;
  };

  const fresh = (slot: Slot): boolean => {
    const last = lastAttempt(slot);
    return last > 0 && now() - last < ttlOf(slot);
  };

  const commit = (slot: Slot, prMap: BranchPrMap): void => {
    slot.prMap = prMap;
    slot.fetchedAt = now();
    slot.failedAt = null;
    slot.error = null;
  };

  const fail = (slot: Slot, err: unknown): void => {
    slot.failedAt = now();
    slot.error = describe(err);
  };

  const start = (slot: Slot, forget: boolean): Promise<BranchPrMap> => {
    const { cwd, config } = slot.scope;
    const provider = slot.scope.provider as VcsProvider;
    fetches += 1;
    const request = (async () => {
      // At the start of this request, not when the refresh was asked
      // for: a request that was already out has finished by now, so
      // nothing can write the forgotten answers back before this one
      // reads.
      if (forget) provider.forgetPullRequestCache?.(config.vendorProject);
      return provider.fetchPullRequests(
        config.vendorAuth,
        config.vendorProject
      );
    })();
    const settled = request
      .then(
        (prMap) => {
          if (!live(slot)) return getSnapshot(cwd).prMap;
          commit(slot, prMap);
          return prMap;
        },
        (err: unknown) => {
          logError(`fetchPullRequests [${provider.id}]`, err);
          if (live(slot)) fail(slot, err);
          // Serve stale data on failure rather than blanking the list.
          return getSnapshot(cwd).prMap;
        }
      )
      .finally(() => {
        slot.inflight = null;
        slot.usedAt = now();
        changed(slot);
        schedule.reschedule(cwd);
      });
    slot.inflight = settled;
    changed(slot);
    return settled;
  };

  /** A request that postdates this call: now if the scope is idle,
   *  otherwise the one queued behind the request out. */
  const readFresh = (slot: Slot, forget: boolean): Promise<BranchPrMap> => {
    if (slot.queued) {
      slot.queued.forget ||= forget;
      return slot.queued.promise;
    }
    if (!slot.inflight) return start(slot, forget);
    const queued: Queued = { forget, promise: slot.inflight };
    queued.promise = slot.inflight.then(() => {
      slot.queued = null;
      // Resolved again: the config may have moved while the request
      // ahead was out. A different scope has no stale request to wait
      // out, so an ordinary read answers there.
      const next = slotFor(slot.scope.cwd);
      return next === slot ? start(slot, queued.forget) : readIn(next, {});
    });
    slot.queued = queued;
    return queued.promise;
  };

  const readIn = (
    slot: Slot,
    opts: { force?: boolean; forget?: boolean }
  ): Promise<BranchPrMap> => {
    if (!slot.scope.configured) return Promise.resolve(NO_PULL_REQUESTS);
    if (opts.force) return readFresh(slot, opts.forget ?? false);
    if (fresh(slot)) return Promise.resolve(slot.prMap);
    return slot.inflight ?? slot.queued?.promise ?? start(slot, false);
  };

  const read = (
    cwd: string,
    opts: { force?: boolean; forget?: boolean } = {}
  ): Promise<BranchPrMap> => readIn(slotFor(cwd), opts);

  const schedule = createPollSchedule({
    tick: (cwd) => void read(cwd),
    dueIn: (cwd) => {
      const slot = currentSlot(cwd);
      if (!slot) return 0;
      if (busy(slot)) return null;
      const ttl = ttlOf(slot);
      if (!slot.scope.configured) return ttl;
      const last = lastAttempt(slot);
      return last === 0 ? 0 : Math.max(0, last + ttl - now());
    },
  });

  const lookupPullRequest = async (
    cwd: string,
    prId: number
  ): Promise<PullRequestLookup> => {
    const slot = slotFor(cwd);
    if (!slot.scope.configured) {
      return { kind: 'unknown', reason: 'No provider is configured' };
    }
    const prMap = await readIn(slot, {});
    const pr = Object.values(prMap).find((entry) => entry?.id === prId);
    if (pr) return { kind: 'found', pr };
    const { error, fetchedAt } = getSnapshot(cwd);
    if (error) return { kind: 'unknown', reason: error };
    if (fetchedAt === null) {
      return {
        kind: 'unknown',
        reason: 'The pull request list has not loaded',
      };
    }
    return { kind: 'gone' };
  };

  return {
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read: (cwd, opts) => read(cwd, { force: opts?.force }),
    refresh: (cwd) => read(cwd, { force: true, forget: true }),
    refreshInBackground: (cwd) => {
      void read(cwd);
    },
    watch: (cwd) => schedule.watch(cwd),
    lookupPullRequest,
    credentialsChanged: () => {
      // Every provider, not just a repository's current one: on a
      // vendor change the stale answers belong to the one being left.
      for (const provider of providers) provider.resetCaches?.();
      generation += 1;
      // Requests still out belong to retired slots: they settle, but
      // commit nowhere and hand their callers the post-clear list.
      slots.clear();
      for (const cwd of current.keys()) emit(cwd);
      schedule.rescheduleAll();
    },
    fetchCount: () => fetches,
    dispose: () => {
      schedule.dispose();
      listeners.clear();
    },
  };
}
