import type { PullRequestInfo, CategorizedReviews } from '@n10/vcs-core';
import type { AgentSession, ReviewCategory, SidebarItem } from '../types.js';
import type { BabysitStatus } from '../babysit/babysit-model.js';

/** Babysit statuses by pull request id. */
export type BabysatMap = ReadonlyMap<number, BabysitStatus>;

/** The `babysit` field for a pull request, present only when it is
 *  being babysat — an absent key, not an undefined one, so an item's
 *  shape says what it carries. */
function babysitOf(
  pr: PullRequestInfo | undefined,
  babysat: BabysatMap
): { babysit: BabysitStatus } | Record<string, never> {
  const status = pr && babysat.get(pr.id);
  return status ? { babysit: status } : {};
}

/** The branches every review section covers, in one set. */
function collectReviewBranches(reviews: CategorizedReviews): Set<string> {
  return new Set(
    [
      ...reviews.needsReview,
      ...reviews.waitingForAuthor,
      ...reviews.approvedByYou,
    ].map((pr) => pr.sourceBranch)
  );
}

/** A sidebar section, in the order the sidebar reads top to bottom. */
export type SidebarSectionKey =
  | 'worktrees'
  | 'draft-pull-requests'
  | 'pull-requests'
  | ReviewCategory;

export const SIDEBAR_SECTIONS: readonly SidebarSectionKey[] = [
  'worktrees',
  'draft-pull-requests',
  'pull-requests',
  'needs-review',
  'waiting',
  'approved',
];

/**
 * The section an item files under. The pull request sections hold the
 * viewer's own pull requests and the review sections the ones waiting
 * on them; a worktree on any other pull request is a worktree, however
 * much work happens in it.
 */
export function sidebarSection(item: SidebarItem): SidebarSectionKey {
  if (item.kind === 'review-pr') return item.category;
  if (item.kind === 'session' && !(item.pr && item.authored)) {
    return 'worktrees';
  }
  return item.pr?.isDraft ? 'draft-pull-requests' : 'pull-requests';
}

/** The three session sections, in the order they are emitted. */
interface SessionBuckets {
  noPr: SidebarItem[];
  draftPr: SidebarItem[];
  activePr: SidebarItem[];
}

/**
 * Split the worktree sessions across the sections they belong to.
 *
 * A session whose branch is under review is dropped here rather than
 * emitted: it appears in its review section instead, carrying the running
 * LED, and listing it twice would give the same worktree two rows. One
 * on someone else's pull request that no review section lists keeps the
 * pull request on its row but files with the worktrees.
 */
function bucketSessions(
  sortedSessions: AgentSession[],
  reviewBranches: Set<string>,
  sessionPrMap: Map<string, PullRequestInfo>,
  yours: ReadonlySet<number>,
  mergedBranches: Set<string>,
  conflictCounts: Map<string, number>,
  babysat: BabysatMap
): SessionBuckets {
  const buckets: SessionBuckets = { noPr: [], draftPr: [], activePr: [] };

  for (const session of sortedSessions) {
    // '' is a detached HEAD: no branch, so no PR, merge or conflict state.
    const branch = session.branch || undefined;
    if (branch && reviewBranches.has(branch)) continue;

    const pr = sessionPrMap.get(session.name);
    const item: SidebarItem = {
      kind: 'session',
      session,
      pr,
      ...(pr && yours.has(pr.id) ? { authored: true } : {}),
      branch,
      isMerged: branch ? mergedBranches.has(branch) : false,
      conflictCount: branch ? conflictCounts.get(branch) : undefined,
      ...babysitOf(pr, babysat),
    };

    const section = sidebarSection(item);
    if (section === 'draft-pull-requests') buckets.draftPr.push(item);
    else if (section === 'pull-requests') buckets.activePr.push(item);
    else buckets.noPr.push(item);
  }

  return buckets;
}

/**
 * Build a flat, ordered list of sidebar items from all data sources.
 * `yours` holds the ids of the pull requests the viewer authored
 * (`findYourPrIds`).
 *
 * Section headers are NOT in the array — rendering groups the items by
 * `sidebarSection`.
 */
export function buildSidebarItems(
  sortedSessions: AgentSession[],
  orphanPrs: PullRequestInfo[],
  categorizedReviews: CategorizedReviews,
  sessionPrMap: Map<string, PullRequestInfo>,
  yours: ReadonlySet<number>,
  mergedBranches: Set<string>,
  conflictCounts: Map<string, number>,
  babysat: BabysatMap = new Map()
): SidebarItem[] {
  const sessions = bucketSessions(
    sortedSessions,
    collectReviewBranches(categorizedReviews),
    sessionPrMap,
    yours,
    mergedBranches,
    conflictCounts,
    babysat
  );

  const sessionByBranch = new Map<string, AgentSession>();
  for (const s of sortedSessions) {
    if (s.branch) sessionByBranch.set(s.branch, s);
  }

  /** The worktree session of the checkout on a review PR's branch, if
   *  any. */
  const prSession = (pr: PullRequestInfo): AgentSession | undefined =>
    sessionByBranch.get(pr.sourceBranch);

  // An orphan PR's branch is checked out in no worktree (`findOrphanPrs`),
  // so it has no session to carry.
  const orphanItem = (pr: PullRequestInfo): SidebarItem => ({
    kind: 'orphan-pr',
    pr,
    ...babysitOf(pr, babysat),
  });

  const reviewItem =
    (category: ReviewCategory) =>
    (pr: PullRequestInfo): SidebarItem => {
      const session = prSession(pr);
      return {
        kind: 'review-pr',
        pr,
        category,
        running: session?.running,
        sessionName: session?.name,
        ...babysitOf(pr, babysat),
      };
    };

  // The section order the sidebar reads top to bottom. Within the two PR
  // sections, a request that has a worktree checked out sorts above one
  // that does not.
  return [
    // 1. Worktrees — sessions with no PR of yours
    ...sessions.noPr,

    // 2. Draft pull requests
    ...sessions.draftPr,
    ...orphanPrs.filter((p) => p.isDraft === true).map(orphanItem),

    // 3. Pull requests
    ...sessions.activePr,
    ...orphanPrs.filter((p) => p.isDraft !== true).map(orphanItem),

    // 4. Needs review (others' PRs you need to review)
    ...categorizedReviews.needsReview.map(reviewItem('needs-review')),
    // 5. Waiting for author
    ...categorizedReviews.waitingForAuthor.map(reviewItem('waiting')),
    // 6. Approved by you
    ...categorizedReviews.approvedByYou.map(reviewItem('approved')),
  ];
}
