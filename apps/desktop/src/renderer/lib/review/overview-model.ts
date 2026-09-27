import {
  isBlockingDecision,
  type PullRequestInfo,
  type PullRequestReviewer,
  type ReviewDecision,
} from '@n10/vcs-core/types';
import type { Mode } from './review-model.js';

/**
 * What the pull request Overview says, decided from the data it has.
 *
 * Everything here reads the pull request list's row, which carries the
 * draft flag, reviewer verdicts, the CI rollup and the unresolved
 * count — and nothing about branch policies, required reviewers,
 * conflicts or merge permission. So the Overview can name blockers it
 * sees, but can never call a pull request ready: readiness stays "not
 * fully known" until those are read.
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

function unresolvedDetail(pr: PullRequestInfo): string | null {
  const n = pr.activeCommentCount ?? 0;
  if (n === 0) return null;
  return `${n} unresolved thread${n === 1 ? '' : 's'}`;
}

function reviewerStep(
  pr: PullRequestInfo,
  mine: PullRequestReviewer | undefined
): NextStep {
  const step = {
    detail: unresolvedDetail(pr),
    action: 'review-changes' as const,
    label: 'Review changes',
  };
  if (mine?.decision === 'approved') {
    return { ...step, summary: 'You approved this pull request' };
  }
  if (mine && isBlockingDecision(mine.decision)) {
    return { ...step, summary: 'You asked for changes' };
  }
  return {
    ...step,
    summary: mine ? 'Your review is requested' : 'Not reviewed by you yet',
  };
}

function authorStep(pr: PullRequestInfo): NextStep {
  const reviewers = pr.reviewers ?? [];
  const unresolved = unresolvedDetail(pr);
  const view = { action: 'review-changes' as const, label: 'View changes' };
  if (unresolved) {
    return {
      summary: unresolved,
      detail: 'Reviewers are waiting on your replies or fixes.',
      action: 'show-unresolved',
      label: 'Respond to feedback',
    };
  }
  const blocking = reviewers.filter((r) => isBlockingDecision(r.decision));
  if (blocking.length > 0) {
    return {
      ...view,
      summary: `Changes requested by ${names(blocking)}`,
      detail: null,
    };
  }
  if (pr.isDraft) {
    return {
      ...view,
      summary: 'Draft',
      detail: 'Reviewers are not asked to look until it is ready for review.',
    };
  }
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
  return role === 'author'
    ? authorStep(pr)
    : reviewerStep(pr, viewerReview(pr, viewer));
}

/**
 * One fact about completing the pull request. `unknown` is a first-class
 * state, drawn and worded as such: a fact n10 has not read is never shown
 * as met.
 */
export type ReadinessState = 'met' | 'blocked' | 'waiting' | 'unknown';

export interface ReadinessRow {
  id: 'lifecycle' | 'reviews' | 'checks' | 'conflicts' | 'merge';
  label: string;
  state: ReadinessState;
  text: string;
}

export interface Readiness {
  /** The strongest blocker, or why readiness cannot be stated. */
  headline: { state: ReadinessState; text: string };
  rows: ReadinessRow[];
}

function reviewsRow(pr: PullRequestInfo): ReadinessRow {
  const reviewers = pr.reviewers ?? [];
  const row = { id: 'reviews' as const, label: 'Reviews' };
  const blocking = reviewers.filter((r) => isBlockingDecision(r.decision));
  if (blocking.length > 0) {
    return {
      ...row,
      state: 'blocked',
      text: `Changes requested by ${names(blocking)}`,
    };
  }
  const approved = reviewers.filter((r) => r.decision === 'approved');
  if (approved.length > 0) {
    return { ...row, state: 'met', text: `Approved by ${names(approved)}` };
  }
  return {
    ...row,
    state: 'waiting',
    text: reviewers.length > 0 ? 'No verdicts yet' : 'No reviewers requested',
  };
}

const CHECKS: Record<
  NonNullable<PullRequestInfo['buildStatus']>,
  Pick<ReadinessRow, 'state' | 'text'>
> = {
  succeeded: { state: 'met', text: 'Checks passing' },
  failed: { state: 'blocked', text: 'Checks failing' },
  pending: { state: 'waiting', text: 'Checks running' },
  none: { state: 'unknown', text: 'No checks reported' },
};

export function readiness(pr: PullRequestInfo): Readiness {
  const rows: ReadinessRow[] = [
    pr.isDraft
      ? { id: 'lifecycle', label: 'State', state: 'waiting', text: 'Draft' }
      : { id: 'lifecycle', label: 'State', state: 'met', text: 'Open' },
    reviewsRow(pr),
    { id: 'checks', label: 'Checks', ...CHECKS[pr.buildStatus ?? 'none'] },
    {
      id: 'conflicts',
      label: 'Conflicts',
      state: 'unknown',
      text: 'Not checked yet',
    },
    {
      id: 'merge',
      label: 'Policies',
      state: 'unknown',
      text: 'Branch policies and merge permission are not read yet',
    },
  ];
  return { headline: headline(pr, rows), rows };
}

function headline(
  pr: PullRequestInfo,
  rows: readonly ReadinessRow[]
): Readiness['headline'] {
  if (pr.isDraft)
    return { state: 'waiting', text: 'Draft: not ready to merge' };
  const blocked = rows.find((r) => r.state === 'blocked');
  if (blocked) return { state: 'blocked', text: blocked.text };
  return { state: 'unknown', text: 'Readiness not fully known' };
}
