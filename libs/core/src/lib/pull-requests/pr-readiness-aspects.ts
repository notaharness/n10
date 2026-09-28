import type { MergeState, PullRequestCheck } from '@n10/vcs-core';
import type {
  ReadinessInputs,
  ReadinessItem,
  ReadinessTally,
} from './pr-readiness.js';

/**
 * Readiness one fact at a time: the lifecycle, the reviews, the checks
 * and policies, conflicts and conversations, each with where it
 * stands. Every row is decided here from the provider's
 * facts and the verdict's own items; a frontend only words and draws
 * it.
 *
 * `met`, `blocked` and `waiting` stand on the provider's requirement
 * signal: n10 never calls a requirement met that the provider did not
 * state. `advisory` is a problem nothing enforces. `observed` is a fact
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
  id: 'lifecycle' | 'reviews' | 'checks' | 'conflicts' | 'conversations';
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

const UNREAD = {
  failed: 'Could not be read',
  unsupported: 'Not read by this provider',
} as const;

/** Which checks the provider requires is known: its rules were read and
 *  it named every check's requirement, or it says nothing enforced is in
 *  the way. Without its rules, a required check that never reported is
 *  simply absent. */
function requirementsKnown(
  { merge, rules }: ReadinessInputs,
  items: readonly PullRequestCheck[]
): boolean {
  if (merge.blocked === false) return true;
  return (
    rules.state === 'read' && items.every((c) => c.requirement !== 'unknown')
  );
}

/** The worst required check or policy, in the verdict's own words. */
function checks(inputs: ReadinessInputs, t: ReadinessTally): ReadinessAspect {
  const row = { id: 'checks' as const };
  if (inputs.checks.state !== 'read') {
    return { ...row, state: 'unknown', text: UNREAD[inputs.checks.state] };
  }
  // Blockers come what won't clear by waiting first.
  const [held] = t.blockers.filter((b) => CHECK_KINDS.has(b.kind));
  if (held) {
    return {
      ...row,
      state: held.pending ? 'waiting' : 'blocked',
      text: held.text,
    };
  }
  const { items, complete } = inputs.checks.value;
  if (!complete) return { ...row, state: 'unknown', text: 'Not all read' };
  const required = items.filter((c) => c.requirement === 'required');
  if (required.some((c) => c.outcome === 'unknown')) {
    return { ...row, state: 'unknown', text: 'Outcome not known' };
  }
  const advisory = t.advisories.find((a) => CHECK_KINDS.has(a.kind))?.text;
  if (!requirementsKnown(inputs, items)) {
    return {
      ...row,
      state: 'unknown',
      text: advisory ?? 'Not known which are required',
    };
  }
  if (required.length === 0) {
    return advisory
      ? { ...row, state: 'advisory', text: advisory }
      : { ...row, state: 'met', text: 'None required' };
  }
  // A failure nothing enforces stays in sight beside the pass.
  const pass = 'Required checks pass';
  return {
    ...row,
    state: 'met',
    text: advisory ? `${pass} · ${advisory}` : pass,
  };
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

/** Whether the rules ask for threads to be resolved; null unread. */
export function conversationRule(
  rules: ReadinessInputs['rules']
): boolean | null {
  return rules.state === 'read' ? rules.value.conversationResolution : null;
}

/** Resolved only on the provider's word: its own verdict, or its clear
 *  under a rule that asks. The list's count is a lower bound, from its
 *  first page of threads, so none unresolved there is only observed. */
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
  const rule = conversationRule(inputs.rules);
  const { merge } = inputs;
  if (
    merge.conversations === 'resolved' ||
    (rule === true && merge.blocked === false)
  ) {
    return { ...row, state: 'met', text: 'All resolved' };
  }
  if (rule === false) return { ...row, state: 'met', text: 'Not required' };
  if (inputs.unresolvedThreads === 0) {
    return { ...row, state: 'observed', text: 'None unresolved' };
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
  ];
}
