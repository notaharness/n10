import type { AppConfig, VcsProvider } from '@n10/vcs-core';
import type { AgentSession } from '../types.js';

import {
  isBlockingDecision,
  type BranchPrMap,
  type PullRequestInfo,
  type PullRequestReviewer,
  type CategorizedReviews,
} from '@n10/vcs-core/types';

/**
 * Find PRs created by the current user whose branch no worktree has
 * checked out.
 */
export function findOrphanPrs(
  prMap: BranchPrMap,
  checkedOut: ReadonlySet<string>,
  config: AppConfig,
  provider: VcsProvider
): PullRequestInfo[] {
  return Object.values(prMap)
    .filter(
      (pr): pr is PullRequestInfo =>
        pr != null &&
        provider.matchesUser(pr.createdByIdentifier, config) &&
        !checkedOut.has(pr.sourceBranch)
    )
    .sort((a, b) => b.id - a.id);
}

type ReviewBucket = keyof CategorizedReviews;

/** Where the viewer's own entry files a pull request, or nowhere. */
function reviewBucket(
  reviewer: PullRequestReviewer,
  isDraft: boolean
): ReviewBucket | null {
  if (reviewer.decision === 'declined') return null;
  // Asked again after a verdict: the author wants another look. A draft
  // asks for none yet, so its verdict files it as before.
  const askedAgain = reviewer.requested && reviewer.decision !== 'no-response';
  if (askedAgain && !isDraft) return 'needsReview';
  if (reviewer.decision === 'approved') return 'approvedByYou';
  if (isBlockingDecision(reviewer.decision)) return 'waitingForAuthor';
  // A draft is not asking for review yet, so it does not belong in
  // "Needs Your Review" — being listed there is a standing job that
  // cannot be cleared. The other two buckets still take drafts: both
  // record a decision already made, and one of them ("Waiting for
  // Author") is exactly where a PR put back into draft belongs.
  return isDraft ? null : 'needsReview';
}

/**
 * Categorize PRs where the current user is a reviewer.
 */
export function categorizeReviews(
  prMap: BranchPrMap,
  config: AppConfig,
  provider: VcsProvider
): CategorizedReviews {
  const buckets: CategorizedReviews = {
    needsReview: [],
    waitingForAuthor: [],
    approvedByYou: [],
  };
  for (const pr of Object.values(prMap)) {
    if (!pr || !pr.reviewers) continue;
    // Skip PRs created by the current user — they belong in sessions, not reviews
    if (provider.matchesUser(pr.createdByIdentifier, config)) continue;
    const reviewer = pr.reviewers.find((r) =>
      provider.matchesUser(r.identifier, config)
    );
    const bucket = reviewer && reviewBucket(reviewer, pr.isDraft ?? false);
    if (bucket) buckets[bucket].push(pr);
  }
  return buckets;
}

/**
 * Map each worktree session's name to the pull request of the branch
 * checked out in it now.
 */
export function buildSessionPrMap(
  prMap: BranchPrMap,
  sessions: readonly AgentSession[]
): Map<string, PullRequestInfo> {
  const sessionPrMap = new Map<string, PullRequestInfo>();
  for (const session of sessions) {
    const pr = session.branch ? prMap[session.branch] : undefined;
    if (pr) sessionPrMap.set(session.name, pr);
  }
  return sessionPrMap;
}
