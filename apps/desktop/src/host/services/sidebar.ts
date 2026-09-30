import { listWorktrees } from '@n10/worktree-manager';
import {
  buildSidebarItems,
  buildSessionPrMap,
  categorizeReviews,
  findOrphanPrs,
  sortSessionsByPrId,
  worktreeSessionRow,
  type SidebarItem,
} from '@n10/core';
import { pullRequestPollIntervalMs } from '@n10/engine';
import { activeRepoIs, requireRepo } from './repo.js';
import { babysatStatuses } from './babysit.js';
import { isOwnSessionAlive } from './sessions.js';
import { getSyncDecorations } from './remote-sync.js';
import { pullRequests, resolveProvider } from './program.js';
import type { SidebarModel, SyncState } from '../contract.js';

/**
 * Assemble the unified, ordered sidebar model exactly like the TUI's
 * SidebarProvider — worktrees, then draft PRs, then PRs, then the
 * three review buckets — by reusing app-core's pure builders. Runs in
 * the main process where git + provider access is available; the
 * result is plain data streamed to the renderer.
 *
 * Local state (worktrees, alive PTYs) is cheap and re-read on every
 * call; remote pull request data comes from the host's one instance
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
export async function listSidebarItems(): Promise<SidebarItem[]> {
  const cwd = requireRepo();
  const { config, provider } = resolveProvider(cwd);

  // Local git first and on its own: worktrees are the rows the user is
  // most likely looking for, and they must not queue behind a provider
  // call that may be a network round trip away.
  pullRequests.refreshInBackground(cwd);
  const worktrees = await listWorktrees();
  const prMap = pullRequests.getSnapshot(cwd).prMap;
  // Rows are keyed by checkout, so the agent in a worktree stays that
  // worktree's whichever branch it is on now (`worktreeSessionRow`).
  const sessions = worktrees.map((wt) =>
    worktreeSessionRow(wt, isOwnSessionAlive, cwd)
  );

  const checkedOut = new Set(
    sessions.flatMap((s) => (s.branch ? [s.branch] : []))
  );
  const orphanPrs = provider
    ? findOrphanPrs(prMap, checkedOut, config, provider)
    : [];
  const categorizedReviews = provider
    ? categorizeReviews(prMap, config, provider)
    : { needsReview: [], waitingForAuthor: [], approvedByYou: [] };
  const sessionPrMap = buildSessionPrMap(prMap, sessions);
  const sortedSessions = sortSessionsByPrId(sessions, sessionPrMap);

  // Merged/conflict decorations come from the host's remote sync loop
  // (same shared passes the TUI's hooks drive).
  const sync = getSyncDecorations();
  return buildSidebarItems(
    sortedSessions,
    orphanPrs,
    categorizedReviews,
    sessionPrMap,
    sync.merged,
    sync.conflicts,
    babysatStatuses(cwd)
  );
}

/**
 * The sidebar stamped with the repository it describes — what the
 * renderer is handed.
 *
 * `listSidebarItems` reads the open repository more than once over its
 * awaits (the worktree list, then which sessions are this repo's), so a
 * switch landing in between yields rows of one repository with the
 * live state of another. Rather than stamp that, it is computed again
 * for the repository the host is on now, and stamped with that one; the
 * renderer then knows exactly which workspace the answer is for. Bounded,
 * because a host that keeps switching under the call has a bigger
 * problem than a stale sidebar.
 */
export async function getSidebarSnapshot(): Promise<SidebarModel> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cwd = requireRepo();
    const items = await listSidebarItems();
    if (activeRepoIs(cwd)) return { cwd, items };
  }
  throw new Error('The open repository kept changing while listing it');
}

export function getSyncState(): SyncState {
  const cwd = requireRepo();
  const { config, provider, configured } = resolveProvider(cwd);
  const remote = pullRequests.getSnapshot(cwd);
  return {
    providerId: provider?.id ?? null,
    providerConfigured: configured,
    lastRemoteSyncAt: remote.fetchedAt,
    lastGitSyncAt: getSyncDecorations().lastGitSyncAt,
    remoteError: remote.error,
    remoteSyncing: remote.refreshing,
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
  await pullRequests.refresh(requireRepo());
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
