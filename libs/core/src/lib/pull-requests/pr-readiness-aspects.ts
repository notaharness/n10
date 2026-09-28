import type { MergeState } from '@n10/vcs-core';
import type {
  ReadinessInputs,
  ReadinessItem,
  ReadinessTally,
} from './pr-readiness.js';

/**
 * Readiness one fact at a time: the lifecycle, the reviews, the checks
 * and policies, conflicts, conversations and merge permission, each
 * with where it stands. Every row is decided here from the provider's
 * facts and the verdict's own items; a frontend only words and draws
 * it.
 *
 * `met`, `blocked` and `waiting` stand on the provider's requirement
 * signal. `advisory` is a problem nothing enforces. `observed` is a fact
 * whose weight is not read, such as an approval where the requirement
 * is unknown. `unknown` is what was not read or not yet worked out.
 */

export type AspectState =
  | 'met'
  | 'blocked'
  | 'waiting'
  | 'advisory'
  | 'observed'
  | 'unknown';

export interface ReadinessAspect {
  id:
    | 'lifecycle'
    | 'reviews'
    | 'checks'
    | 'conflicts'
    | 'conversations'
    | 'permission';
  state: AspectState;
  text: string;
  /** A problem in the colour it has everywhere else: Azure's Rejected
   *  is the one verdict shown as severe. */
  severe?: boolean;
}

export const LIFECYCLE_ASPECT = {
  draft: { id: 'lifecycle', state: 'blocked', text: 'Draft' },
  open: { id: 'lifecycle', state: 'met', text: 'Open' },
} as const satisfies Record<string, ReadinessAspect>;

/** Merge permission is the completion adapter's to read. */
export const PERMISSION_ASPECT: ReadinessAspect = {
  id: 'permission',
  state: 'unknown',
  text: 'Not read yet',
};

const REVIEWS: Record<MergeState['reviews'], Omit<ReadinessAspect, 'id'>> = {
  approved: { state: 'met', text: 'Approved' },
  'not-required': { state: 'met', text: 'No review required' },
  required: { state: 'waiting', text: 'Waiting for review' },
  'changes-requested': { state: 'blocked', text: 'Changes requested' },
  unknown: { state: 'unknown', text: 'Requirement not stated' },
};

function reviews({ merge }: ReadinessInputs): ReadinessAspect {
  // Moot where the provider says nothing it enforces is in the way.
  if (merge.reviews === 'unknown' && merge.blocked === false) {
    return { id: 'reviews', state: 'met', text: 'Not in the way' };
  }
  return { id: 'reviews', ...REVIEWS[merge.reviews] };
}

const CHECK_KINDS = new Set<ReadinessItem['kind']>(['checks', 'policies']);

/** The worst required check or policy, in the verdict's own words. */
function checks(inputs: ReadinessInputs, t: ReadinessTally): ReadinessAspect {
  const row = { id: 'checks' as const };
  if (inputs.checks.state !== 'read') {
    return { ...row, state: 'unknown', text: 'Could not be read' };
  }
  const held = t.blockers.filter((b) => CHECK_KINDS.has(b.kind));
  const failing = held.find((b) => !b.pending);
  if (failing) return { ...row, state: 'blocked', text: failing.text };
  if (held[0]) return { ...row, state: 'waiting', text: held[0].text };
  const { items, complete } = inputs.checks.value;
  if (!complete) return { ...row, state: 'unknown', text: 'Not all read' };
  const required = items.filter((c) => c.requirement === 'required');
  const advisory = t.advisories.find((a) => CHECK_KINDS.has(a.kind));
  if (required.length === 0) {
    return advisory
      ? { ...row, state: 'advisory', text: advisory.text }
      : { ...row, state: 'met', text: 'None required' };
  }
  return { ...row, state: 'met', text: 'Required checks pass' };
}

function conflicts({ merge }: ReadinessInputs): ReadinessAspect {
  const row = { id: 'conflicts' as const };
  if (merge.conflicts === 'conflicting') {
    return { ...row, state: 'blocked', text: 'Conflicts with its target' };
  }
  if (merge.behind) {
    return { ...row, state: 'blocked', text: 'Behind its target' };
  }
  if (merge.conflicts === 'unknown') {
    return { ...row, state: 'unknown', text: 'Not worked out yet' };
  }
  return { ...row, state: 'met', text: 'No conflicts' };
}

function conversations(
  inputs: ReadinessInputs,
  t: ReadinessTally
): ReadinessAspect {
  const row = { id: 'conversations' as const };
  const is = (i: ReadinessItem) => i.kind === 'conversations';
  const blocker = t.blockers.find(is);
  if (blocker) return { ...row, state: 'blocked', text: blocker.text };
  const advisory = t.advisories.find(is);
  if (advisory) return { ...row, state: 'advisory', text: advisory.text };
  if (
    inputs.merge.conversations === 'resolved' ||
    inputs.unresolvedThreads === 0
  ) {
    return { ...row, state: 'met', text: 'All resolved' };
  }
  return { ...row, state: 'unknown', text: 'Not read' };
}

export function readinessAspects(
  inputs: ReadinessInputs,
  t: ReadinessTally
): ReadinessAspect[] {
  return [
    inputs.merge.lifecycle.isDraft
      ? LIFECYCLE_ASPECT.draft
      : LIFECYCLE_ASPECT.open,
    reviews(inputs),
    checks(inputs, t),
    conflicts(inputs),
    conversations(inputs, t),
    PERMISSION_ASPECT,
  ];
}
