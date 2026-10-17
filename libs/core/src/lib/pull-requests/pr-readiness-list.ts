import {
  holdingVerdict,
  reviewersToCount,
  type PullRequestInfo,
  type PullRequestReviewer,
} from '@n10/vcs-core';
import {
  LIFECYCLE_ASPECT,
  type ReadinessAspect,
} from './pr-readiness-aspects.js';
import type { PullRequestReadiness, ReadinessItem } from './pr-readiness.js';

/**
 * Readiness from the pull request list's row alone, where its checks
 * and policies could not be read. The row carries the draft flag,
 * reviewer verdicts, the CI rollup and the unresolved count, and
 * nothing about requirements or conflicts. So only
 * the draft is a verdict; a holding verdict or a failing check is a
 * visible problem whose weight is not known, and an approval or a
 * passing check is a fact, never a satisfied requirement.
 */

/** A holding verdict in the provider's own words: Azure's -10 and -5
 *  are different votes. */
const HOLDING_PHRASE: Record<
  NonNullable<ReturnType<typeof holdingVerdict>>['decision'],
  (who: string) => string
> = {
  rejected: (who) => `Rejected by ${who}`,
  'waiting-for-author': (who) => `Waiting for author: ${who}`,
  'changes-requested': (who) => `Changes requested by ${who}`,
};

function names(reviewers: readonly PullRequestReviewer[]): string {
  const [first, ...rest] = reviewers.map((r) => r.displayName);
  if (rest.length === 0) return first ?? '';
  return `${first} and ${rest.length} other${rest.length === 1 ? '' : 's'}`;
}

function holding(reviewers: readonly PullRequestReviewer[]): string | null {
  const verdict = holdingVerdict(reviewers);
  return verdict && HOLDING_PHRASE[verdict.decision](names(verdict.by));
}

function reviews(pr: PullRequestInfo): ReadinessAspect {
  // One row per vote: a team a listed member voted for is that vote.
  const all = reviewersToCount(pr.reviewers ?? []);
  const asked = all.filter((r) => r.decision !== 'declined');
  const row = { id: 'reviews' as const };
  const held = holding(asked);
  if (held) {
    const severe = asked.some((r) => r.decision === 'rejected');
    return { ...row, state: 'advisory', text: held, severe };
  }
  if (asked.length === 0) {
    const text =
      all.length === 0 ? 'No reviewers requested' : `Declined by ${names(all)}`;
    return { ...row, state: 'observed', text };
  }
  const approved = asked.filter((r) => r.decision === 'approved');
  const pending = asked.length - approved.length;
  const text =
    approved.length === 0
      ? `${pending} pending`
      : pending === 0
      ? `Approved by ${names(approved)}`
      : `Approved by ${names(approved)} · ${pending} pending`;
  return { ...row, state: 'observed', text };
}

/** GitHub's rollup and Azure's statuses carry only what reported: a
 *  required check that never ran is absent, and a failing one may be
 *  optional. */
const ROLLUP: Record<
  NonNullable<PullRequestInfo['buildStatus']>,
  Pick<ReadinessAspect, 'state' | 'text'>
> = {
  succeeded: { state: 'observed', text: 'Reported checks pass' },
  failed: { state: 'advisory', text: 'Failing, may be required' },
  pending: { state: 'observed', text: 'Running' },
  none: { state: 'unknown', text: 'None reported' },
};

function conversations(pr: PullRequestInfo): ReadinessAspect {
  const n = pr.activeCommentCount;
  const row = { id: 'conversations' as const };
  if (n == null) return { ...row, state: 'unknown', text: "Couldn't check" };
  if (n === 0) return { ...row, state: 'observed', text: 'None unresolved' };
  return {
    ...row,
    state: 'observed',
    text: `${n} unresolved, may need resolving`,
  };
}

const UNREAD: ReadinessAspect[] = [
  { id: 'reviews', state: 'unknown', text: "Couldn't check" },
  { id: 'checks', state: 'unknown', text: "Couldn't load" },
  { id: 'conversations', state: 'unknown', text: "Couldn't check" },
];

function advisoriesOf(aspects: readonly ReadinessAspect[]): ReadinessItem[] {
  return aspects
    .filter((a) => a.state === 'advisory')
    .map((a) => ({
      kind: a.id === 'checks' ? 'checks' : 'reviews',
      text: a.id === 'checks' ? 'Checks failing' : a.text,
      resolvedBy: 'author',
    }));
}

/** Readiness from the list row, or from nothing where the list has no
 *  row for it either. */
export function listReadiness(
  pr: PullRequestInfo | null
): PullRequestReadiness {
  const draft = pr?.isDraft === true;
  const aspects: ReadinessAspect[] = pr
    ? [
        draft ? LIFECYCLE_ASPECT.draft : LIFECYCLE_ASPECT.open,
        reviews(pr),
        { id: 'checks', ...ROLLUP[pr.buildStatus ?? 'none'] },
        // Conflicts are a row only where the provider reports one; the
        // list reads none, so they are among the unknowns.
        conversations(pr),
      ]
    : [
        { id: 'lifecycle', state: 'unknown', text: "Couldn't check" },
        ...UNREAD,
      ];
  return {
    state: draft ? 'blocked' : 'unknown',
    blockers: draft
      ? [{ kind: 'draft', text: 'Draft', resolvedBy: 'author' }]
      : [],
    advisories: advisoriesOf(aspects),
    unknowns: ['Checks and policies', 'Conflicts', 'The review requirement'],
    aspects,
  };
}
