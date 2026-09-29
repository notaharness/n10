/**
 * The host's instance of `@n10/engine`'s pull request list, and the
 * bridge from its changes to the renderer.
 *
 * Every host-side reader of the pull request list sits on this one
 * instance: the sidebar model, the babysitters (one row each, every
 * minute) and the sync loop's conflict counts, which need to know a
 * branch's target. One instance is what keeps a watched row from
 * costing the provider a fetch of its own.
 */
import {
  EMPTY_PULL_REQUEST_LIST,
  createPullRequestList,
  providerResolver,
  type PullRequestListSnapshot,
} from '@n10/engine';
import type { PullRequestLookup } from '@n10/core';
import type { BranchPrMap, VcsProvider } from '@n10/vcs-core';
import { PROVIDERS } from './repo.js';

export const resolveProvider = providerResolver(PROVIDERS);

export const pullRequests = createPullRequestList({ providers: PROVIDERS });

// Installed by main.ts. Fires when what the sidebar would answer has
// moved, so the renderer refetches then rather than on its next poll
// tick.
let remoteUpdated: (() => void) | null = null;

export function setRemoteUpdatedNotifier(fn: (() => void) | null): void {
  remoteUpdated = fn;
}

// The engine announces every change, a request starting included. The
// renderer is told only about the ones it would paint — a list that
// landed, an error that appeared or cleared — since each announcement
// costs it a sidebar reload.
const announced = new Map<string, PullRequestListSnapshot>();
pullRequests.subscribe((cwd) => {
  const next = pullRequests.getSnapshot(cwd);
  const last = announced.get(cwd) ?? EMPTY_PULL_REQUEST_LIST;
  announced.set(cwd, next);
  if (next.prMap === last.prMap && next.error === last.error) return;
  remoteUpdated?.();
});

/** The provider the repository at `cwd` is configured for, if any. */
export function repoProvider(cwd: string): VcsProvider | null {
  const { provider, configured } = resolveProvider(cwd);
  return configured ? provider : null;
}

/**
 * One pull request as the list has it, refreshed on the list's own
 * schedule — a babysitter asking every minute reads what the sidebar
 * reads, rather than costing the provider a fetch per watched row.
 */
export function lookupPullRequest(
  cwd: string,
  prId: number
): Promise<PullRequestLookup> {
  return pullRequests.lookupPullRequest(cwd, prId);
}

/** The list as held for `cwd`, without waiting for anything. */
export function cachedPullRequests(cwd: string): BranchPrMap {
  return pullRequests.getSnapshot(cwd).prMap;
}
