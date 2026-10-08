import {
  buildSidebarItems,
  buildSessionPrMap,
  categorizeReviews,
  findOrphanPrs,
  findYourPrIds,
  sortSessionsByPrId,
  type SidebarItem,
} from '@n10/core';
import { pullRequestPollIntervalMs, type RepositoryHandle } from '@n10/engine';
import { activeReviewService, repository, requireRepo } from './repo.js';
import { babysatStatuses } from './babysit.js';
import { getSyncDecorations, refreshRemoteSync } from './remote-sync.js';
import { pullRequests, resolveProvider } from './program.js';
import type { SidebarModel, SyncState } from '../contract.js';

/**
 * Assemble the unified, ordered sidebar model exactly like the TUI's
 * SidebarProvider — worktrees, then draft PRs, then PRs, then the
 * three review buckets — by reusing core's pure builders. Runs in
 * the host process where Git and provider access are available; the
 * result is plain data streamed to the renderer.
 *
 * Worktree session rows and liveness come from the captured engine handle.
 * Remote pull request data comes from the host's one instance
 * of `@n10/engine`'s pull request list (`services/pull-requests.ts`),
 * so the renderer can poll the model frequently without hammering the
 * provider API. The renderer's poll is also the list's demand: each
 * call starts a read when one is due.
 *
 * **The model never waits for the network.** A cold start has no
 * cached pull requests, and awaiting them here meant the sidebar — the
 * whole left half of the window, including worktrees git could have
 * listed in milliseconds — stayed empty until GitHub answered. So a
 * call serves whatever remote data exists (possibly none), starts a
 * fetch if one is due, and the fetch announces itself when it lands;
 * the renderer refetches on that event rather than waiting out its
 * poll interval. Only an explicit refresh, where the user is watching
 * a spinner they asked for, still awaits.
 *
 * Merge/conflict decorations (mergedBranches, conflictCounts) come
 * from the host's remote sync loop (services/remote-sync.ts); a
 * babysat pull request's status from the babysit service, so a row
 * wears its badge without a query of its own.
 */

/** The rows alone. Exported for its tests; the bridge serves
 *  `getSidebarSnapshot`, which says which repository they are of. */
export async function listSidebarItems(
  repo: RepositoryHandle
): Promise<SidebarItem[]> {
  const cwd = repo.cwd;
  const { config, provider } = resolveProvider(cwd);

  // Local git first and on its own: worktrees are the rows the user is
  // most likely looking for, and they must not queue behind a provider
  // call that may be a network round trip away. A parked repository
  // answers what it holds, refreshed behind it once that is old.
  repo.prewarm();
  const sessions = await repo.sessions.read();
  const prMap = pullRequests.getSnapshot(cwd).prMap;

  const checkedOut = new Set(
    sessions.flatMap((s) => (s.branch ? [s.branch] : []))
  );
  const orphanPrs = provider
    ? findOrphanPrs(prMap, checkedOut, config, provider)
    : [];
  const categorizedReviews = provider
    ? categorizeReviews(prMap, config, provider)
    : { needsReview: [], waitingForAuthor: [], approvedByYou: [] };
  const yours = provider
    ? findYourPrIds(prMap, config, provider)
    : new Set<number>();
  const sessionPrMap = buildSessionPrMap(prMap, sessions);
  const sortedSessions = sortSessionsByPrId(sessions, sessionPrMap);

  // Merged/conflict decorations come from the host's remote sync loop
  // (the same engine service the TUI observes).
  const sync = getSyncDecorations(cwd);
  return buildSidebarItems(
    sortedSessions,
    orphanPrs,
    categorizedReviews,
    sessionPrMap,
    yours,
    sync.merged,
    sync.conflicts,
    babysatStatuses(cwd)
  );
}

/** The sidebar of `cwd`, open or parked, stamped with the repository
 *  it describes — what the renderer is handed. */
export async function getSidebarSnapshot(cwd: string): Promise<SidebarModel> {
  const repo = repository(cwd);
  return { cwd: repo.cwd, items: await listSidebarItems(repo) };
}

export function getSyncState(cwd: string): SyncState {
  const { config, provider, configured } = resolveProvider(cwd);
  const remote = pullRequests.getSnapshot(cwd);
  const decorations = getSyncDecorations(cwd);
  return {
    providerId: provider?.id ?? null,
    providerConfigured: configured,
    lastRemoteSyncAt: remote.fetchedAt,
    lastGitSyncAt: decorations.lastGitSyncAt,
    remoteError: remote.error ?? decorations.error,
    remoteSyncing: remote.refreshing || decorations.loading,
    remoteIntervalMs: pullRequestPollIntervalMs(config.prPollInterval),
    remoteFetches: pullRequests.fetchCount(),
  };
}

/**
 * The user pressed refresh.
 *
 * Deeper than a poll on purpose: a provider may hold per-row answers
 * well beyond one response — Azure remembers a settled CI verdict for
 * ten minutes — and answering a button from memory is what makes the
 * button look broken. The engine has the provider forget when this
 * refresh's own request starts.
 */
export async function refreshRemote(): Promise<void> {
  const reviews = activeReviewService();
  await Promise.all([pullRequests.refresh(requireRepo()), refreshRemoteSync()]);
  reviews.invalidateProvider();
}

/**
 * Re-read the pull request list now, without telling the provider to
 * forget anything.
 *
 * For the places the app itself knows something changed and knows what:
 * submitting a review verdict changes the reviewer votes, which come
 * from the list, and nothing a provider caches per row carries them.
 */
export async function refreshPrList(): Promise<void> {
  await pullRequests.read(requireRepo(), { force: true });
}
