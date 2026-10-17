import type { BranchPrMap } from '@n10/vcs-core';

const PULL_REQUEST_POLL_DEFAULT_MS = 60_000;

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
