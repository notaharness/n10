import {
  reviewersToCount,
  type PullRequestInfo,
  type PullRequestReviewer,
  type ReviewDecision,
} from '@n10/vcs-core/types';
import type { Mode } from './review-model.js';

/**
 * What the pull request Overview says, decided from the data it has.
 *
 * Everything here reads the pull request list's row: whose pull request
 * it is, where the tab opens, and the reader's next step. Nothing here
 * decides what blocks: whether a review is required is core's
 * readiness, which the Completion section shows.
 */

export type ReviewRole = 'author' | 'reviewer';

/** Whose pull request this is, from where the reader stands. An
 *  unknown viewer reads as a reviewer. */
export function reviewRole(
  pr: PullRequestInfo,
  viewer: string | null
): ReviewRole {
  return viewer != null &&
    pr.createdByIdentifier.toLowerCase() === viewer.toLowerCase()
    ? 'author'
    : 'reviewer';
}

/**
 * The pane a tab opens on. A running agent is what the tab is for.
 * Otherwise a pull request opens on its Overview, whoever wrote it —
 * the pull request's main page, from which Review changes leads to the
 * diff. A worktree with no pull request has no Overview, and opens on
 * its diff.
 */
export function initialMode({
  running,
  hasPr,
}: {
  running: boolean;
  hasPr: boolean;
}): Mode {
  if (running) return 'agent';
  return reviewStart(hasPr);
}

/** The panes that are the pull request's review, as opposed to the
 *  agent, a walkthrough or the plan. */
export type ReviewPane = 'overview' | 'diff';

/** Where the review starts: the Overview, when there is a pull request
 *  to have one. */
export function reviewStart(hasPr: boolean): ReviewPane {
  return hasPr ? 'overview' : 'diff';
}

/** The review pane the reader was last on, or null before either has
 *  shown. The terminal, a walkthrough and the plan leave it as it was. */
export function lastReviewPane(
  last: ReviewPane | null,
  mode: Mode
): ReviewPane | null {
  return mode === 'overview' || mode === 'diff' ? mode : last;
}

/** The review pane the reader was last on; before either has shown,
 *  where the review starts. */
export function backToReviewPane(
  last: ReviewPane | null,
  hasPr: boolean
): ReviewPane {
  return last ?? reviewStart(hasPr);
}

/** Where Back goes from `mode`, always up, never back through where the
 *  reader has been: from the changes to the Overview, the top of the
 *  review; from the terminal, the plan or the walkthrough to the review
 *  pane last shown. The Overview has nowhere further up. */
export function backTarget(mode: Mode, review: ReviewPane): ReviewPane | null {
  if (mode === 'overview') return null;
  return mode === 'diff' ? 'overview' : review;
}

/** A reviewer's decision in words. `no-response` is a request nobody
 *  has answered yet, which is what both providers mean by it. */
export const DECISION_LABEL: Record<ReviewDecision, string> = {
  approved: 'Approved',
  'changes-requested': 'Changes requested',
  'waiting-for-author': 'Waiting for author',
  rejected: 'Rejected',
  'no-response': 'Pending',
  declined: 'Declined',
};

/** The pane a workspace shows, and whether the reader picked it. */
export interface PaneState {
  mode: Mode;
  /** The reader, or an agent taking over, chose this pane. */
  chosen: boolean;
  hasPr: boolean;
}

/**
 * A pull request that arrives after its tab opened — the sidebar lists
 * worktrees before pull requests — opens where it would have, unless
 * the reader has already picked a pane.
 */
export function adoptPullRequest(
  state: PaneState,
  hasPr: boolean,
  initial: Mode
): PaneState {
  if (state.hasPr === hasPr) return state;
  return { ...state, hasPr, mode: state.chosen ? state.mode : initial };
}

/** What the Overview's next-step button does. */
export type AttentionAction = 'review-changes' | 'show-unresolved';

/** The Overview's next-step button: what it says and where it leads. */
export interface NextStep {
  action: AttentionAction;
  label: string;
}

/**
 * The reader's next step, by role. A reviewer reviews the changes, or
 * views a draft's; an author with unresolved threads goes to them, and
 * otherwise views the changes. Deterministic: the same row always
 * says the same thing.
 */
export function nextStep(pr: PullRequestInfo, role: ReviewRole): NextStep {
  if (role === 'author' && (pr.activeCommentCount ?? 0) > 0) {
    return { action: 'show-unresolved', label: 'Respond to feedback' };
  }
  const reviewing = role === 'reviewer' && !pr.isDraft;
  return {
    action: 'review-changes',
    label: reviewing ? 'Review changes' : 'View changes',
  };
}

/** The reviewers still asked for a verdict, one row per vote
 *  (`reviewersToCount`): one who declined is not. */
export function activeReviewers(
  reviewers: readonly PullRequestReviewer[]
): PullRequestReviewer[] {
  return reviewersToCount(reviewers).filter((r) => r.decision !== 'declined');
}
