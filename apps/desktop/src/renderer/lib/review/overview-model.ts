import {
  type PullRequestInfo,
  type PullRequestReviewer,
  type ReviewDecision,
} from '@n10/vcs-core/types';
import type { Mode } from './review-model.js';

/**
 * What the pull request Overview says, decided from the data it has.
 *
 * Everything here reads the pull request list's row: whose pull request
 * it is, where the tab opens, and the reader's next step. Readiness is
 * not decided here: core evaluates it from the provider's own facts
 * (`pr-readiness.ts`), and the Completion section only shows it.
 */

export type ReviewRole = 'author' | 'reviewer';

/** Whose pull request this is, from where the reader stands. An
 *  unknown viewer reads as a reviewer: the Overview is the safe start. */
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
 * The pane a tab opens on. A running agent is what the tab is for. A
 * pull request someone asked you to review opens on its Overview —
 * what it is and why, before any code. Your own work opens on its diff.
 */
export function initialMode({
  running,
  hasPr,
  role,
}: {
  running: boolean;
  hasPr: boolean;
  role: ReviewRole;
}): Mode {
  if (running) return 'agent';
  return hasPr && role === 'reviewer' ? 'overview' : 'diff';
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

/** The viewer's own entry among the reviewers, if they are one. */
export function viewerReview(
  pr: PullRequestInfo,
  viewer: string | null
): PullRequestReviewer | undefined {
  if (viewer == null) return undefined;
  const me = viewer.toLowerCase();
  return pr.reviewers?.find((r) => r.identifier.toLowerCase() === me);
}

/** What the primary button in the attention strip does. */
export type AttentionAction = 'review-changes' | 'show-unresolved';

export interface NextStep {
  /** One sentence: the state that matters most to this reader. */
  summary: string;
  /** Supporting facts, or null. */
  detail: string | null;
  action: AttentionAction;
  label: string;
}

function names(reviewers: readonly PullRequestReviewer[]): string {
  const [first, ...rest] = reviewers.map((r) => r.displayName);
  if (rest.length === 0) return first ?? '';
  return `${first} and ${rest.length} other${rest.length === 1 ? '' : 's'}`;
}

/** The verdicts that hold a pull request back, most severe first, each
 *  in its provider's own words: Azure's -10 and -5 are different votes,
 *  and GitHub has only the third. */
export const HOLDING_VERDICTS = [
  'rejected',
  'waiting-for-author',
  'changes-requested',
] as const;

const HOLDING_PHRASE: Record<
  (typeof HOLDING_VERDICTS)[number],
  (who: string) => string
> = {
  rejected: (who) => `Rejected by ${who}`,
  'waiting-for-author': (who) => `Waiting for author: ${who}`,
  'changes-requested': (who) => `Changes requested by ${who}`,
};

/** The most severe verdict holding the pull request back, or null. */
function holdingVerdict(
  reviewers: readonly PullRequestReviewer[]
): string | null {
  for (const decision of HOLDING_VERDICTS) {
    const who = reviewers.filter((r) => r.decision === decision);
    if (who.length > 0) return HOLDING_PHRASE[decision](names(who));
  }
  return null;
}

function unresolvedDetail(pr: PullRequestInfo): string | null {
  const n = pr.activeCommentCount ?? 0;
  if (n === 0) return null;
  return `${n} unresolved thread${n === 1 ? '' : 's'}`;
}

/** What a reviewer's own verdict says back to them. */
const OWN_VERDICT: Partial<Record<PullRequestReviewer['decision'], string>> = {
  approved: 'You approved this pull request',
  'changes-requested': 'You asked for changes',
  'waiting-for-author': 'You are waiting for the author',
  rejected: 'You rejected this pull request',
  declined: 'You declined to review',
};

function reviewerStep(pr: PullRequestInfo, viewer: string | null): NextStep {
  const step = {
    detail: unresolvedDetail(pr),
    action: 'review-changes' as const,
    label: 'Review changes',
  };
  // A draft is not asking for review yet, which is also why the sidebar
  // keeps it out of Needs your review.
  if (pr.isDraft) {
    return {
      ...step,
      summary: 'Draft: not ready for review yet',
      label: 'View changes',
    };
  }
  if (viewer == null) {
    return {
      ...step,
      summary: 'n10 cannot see your review',
      detail: 'No account is configured for this repository.',
    };
  }
  const mine = viewerReview(pr, viewer);
  const own = mine && OWN_VERDICT[mine.decision];
  if (own) return { ...step, summary: own };
  return {
    ...step,
    summary: mine ? 'Your review is requested' : 'Not reviewed by you yet',
  };
}

function authorStep(pr: PullRequestInfo): NextStep {
  const reviewers = pr.reviewers ?? [];
  const unresolved = unresolvedDetail(pr);
  const view = { action: 'review-changes' as const, label: 'View changes' };
  // The count is the fact; who owes the next move on each thread is not
  // something it says.
  if (unresolved) {
    return {
      summary: unresolved,
      detail: null,
      action: 'show-unresolved',
      label: 'Respond to feedback',
    };
  }
  const holding = holdingVerdict(reviewers);
  if (holding) return { ...view, summary: holding, detail: null };
  if (pr.isDraft) return { ...view, summary: 'Draft', detail: null };
  const approved = reviewers.filter((r) => r.decision === 'approved');
  if (approved.length > 0) {
    return { ...view, summary: `Approved by ${names(approved)}`, detail: null };
  }
  return {
    ...view,
    summary: 'Waiting for review',
    detail: reviewers.length === 0 ? 'No reviewers are requested.' : null,
  };
}

/** The reader's next step, by role. Deterministic: the same row always
 *  says the same thing. */
export function nextStep(
  pr: PullRequestInfo,
  role: ReviewRole,
  viewer: string | null
): NextStep {
  return role === 'author' ? authorStep(pr) : reviewerStep(pr, viewer);
}

/** The reviewers still asked for a verdict: one who declined is not. */
export function activeReviewers(
  reviewers: readonly PullRequestReviewer[]
): PullRequestReviewer[] {
  return reviewers.filter((r) => r.decision !== 'declined');
}
