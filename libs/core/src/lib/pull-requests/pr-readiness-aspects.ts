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
  unknown: { state: 'unknown', text: 'May need a review' },
};

/** The approvals the rules ask for, in words, or that the rules could
 *  not be read; null where they ask none, or the provider reads none. */
function approvalsAsked({ rules }: ReadinessInputs): string | null {
  if (rules.state === 'failed') return "branch rules didn't load";
  const n = rules.state === 'read' ? rules.value.reviews.approvals : 0;
  return n > 0 ? `${n} approval${n === 1 ? '' : 's'} required` : null;
}

/** The provider's verdict and the count the rules ask for. Who must
 *  approve, and why, is the reviewers' to say. */
function reviews(inputs: ReadinessInputs): ReadinessAspect {
  const { merge } = inputs;
  const asked = approvalsAsked(inputs);
  // Moot where the provider says nothing it enforces is in the way.
  if (merge.reviews === 'unknown' && merge.blocked === false) {
    return { id: 'reviews', state: 'met', text: 'Nothing blocking' };
  }
  const { state, text } = REVIEWS[merge.reviews];
  if (!asked || merge.reviews === 'not-required') {
    return { id: 'reviews', state, text };
  }
  // A count with no verdict stated is the rule alone; rules that could
  // not be read leave the verdict's own words beside them.
  const alone = merge.reviews === 'unknown' && inputs.rules.state === 'read';
  return { id: 'reviews', state, text: alone ? asked : `${text} · ${asked}` };
}

const CHECK_KINDS = new Set<ReadinessItem['kind']>(['checks', 'policies']);

const UNREAD = {
  failed: "Couldn't load",
  unsupported: 'Not available',
} as const;

/** The provider named which checks it requires: its rules were read
 *  and every check's requirement is stated. Without its rules, a
 *  required check that never reported is simply absent. */
function requirementsStated(
  { rules }: ReadinessInputs,
  items: readonly PullRequestCheck[]
): boolean {
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
  // Blockers come what someone must act on first.
  const [held] = t.blockers.filter((b) => CHECK_KINDS.has(b.kind));
  if (held) {
    return {
      ...row,
      state: held.pending ? 'waiting' : 'blocked',
      text: held.text,
    };
  }
  const { items, complete } = inputs.checks.value;
  if (!complete) return { ...row, state: 'unknown', text: "Some didn't load" };
  const required = items.filter((c) => c.requirement === 'required');
  if (required.some((c) => c.outcome === 'unknown')) {
    return {
      ...row,
      state: 'unknown',
      text: 'A required check has no clear result',
    };
  }
  const advisory = t.advisories.find((a) => CHECK_KINDS.has(a.kind))?.text;
  if (!requirementsStated(inputs, items)) {
    return unstated(inputs, row, required.length > 0, advisory);
  }
  if (required.length === 0) {
    return advisory
      ? { ...row, state: 'advisory', text: advisory }
      : { ...row, state: 'met', text: 'None required' };
  }
  return passing(row, advisory);
}

/** A failure nothing enforces stays in sight beside the pass. */
function passing(
  row: { id: 'checks' },
  advisory: string | undefined
): ReadinessAspect {
  const pass = 'Required checks pass';
  return {
    ...row,
    state: 'met',
    text: advisory ? `${pass} · ${advisory}` : pass,
  };
}

/** Which checks are required is not stated. Where the provider says
 *  nothing enforced is in the way that is moot, and says only that;
 *  otherwise it is not known. */
function unstated(
  { merge }: ReadinessInputs,
  row: { id: 'checks' },
  anyRequired: boolean,
  advisory: string | undefined
): ReadinessAspect {
  if (merge.blocked !== false) {
    return {
      ...row,
      state: 'unknown',
      text: advisory ?? 'Unclear which are required',
    };
  }
  if (advisory) return { ...row, state: 'advisory', text: advisory };
  return anyRequired
    ? passing(row, undefined)
    : { ...row, state: 'met', text: 'Nothing blocking' };
}

/** Shown only where the provider reports a conflict: otherwise there
 *  is nothing to act on, and a mergeability the provider has not worked
 *  out is among the verdict's unknowns. A branch behind its target is
 *  not a conflict; the verdict's blockers name it. */
function conflicts({ merge }: ReadinessInputs): ReadinessAspect[] {
  if (merge.conflicts !== 'conflicting') return [];
  return [
    { id: 'conflicts', state: 'blocked', text: 'Conflicts with its target' },
  ];
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
  return { ...row, state: 'unknown', text: "Couldn't check" };
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
    ...conflicts(inputs),
    conversations(inputs, t),
  ];
}
