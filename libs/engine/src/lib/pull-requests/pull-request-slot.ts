import type { BranchPrMap } from '@n10/vcs-core';
import type { PullRequestScope } from './pull-request-scope.js';
import {
  EMPTY_PULL_REQUEST_LIST,
  pullRequestPollIntervalMs,
  type PullRequestListSnapshot,
} from './pull-request-snapshot.js';

/** A request queued behind the one out, shared by every forced read
 *  made meanwhile. */
export interface Queued {
  promise: Promise<BranchPrMap>;
  /** Some refresh sharing this request asked the provider to forget. */
  forget: boolean;
}

export interface Slot {
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

export const NO_PULL_REQUESTS = EMPTY_PULL_REQUEST_LIST.prMap;

export function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function busy(slot: Slot): boolean {
  return slot.inflight !== null || slot.queued !== null;
}

export function snapshotOf(slot: Slot): PullRequestListSnapshot {
  return {
    prMap: slot.prMap,
    fetchedAt: slot.fetchedAt,
    error: slot.error,
    refreshing: busy(slot),
  };
}

export function ttlOf(slot: Slot): number {
  return pullRequestPollIntervalMs(slot.scope.config.prPollInterval);
}

export function sameSnapshot(
  a: PullRequestListSnapshot,
  b: PullRequestListSnapshot
): boolean {
  return (
    a.prMap === b.prMap &&
    a.fetchedAt === b.fetchedAt &&
    a.error === b.error &&
    a.refreshing === b.refreshing
  );
}

/** When the last attempt, successful or not, finished; 0 for never. */
export function lastAttempt(slot: Slot): number {
  return Math.max(slot.fetchedAt ?? 0, slot.failedAt ?? 0);
}
