import type {
  BranchRules,
  ListRead,
  MergeState,
  PullRequestCheck,
  ReadOutcome,
} from '@n10/vcs-core';

/**
 * Whether a pull request can complete, as its provider says, with the
 * provider's own facts that explain it: mergeability, the review
 * requirement, the head's checks and the target's rules. The verdict is
 * the provider's (`MergeState.blocked`); n10 adds none. It is unknown
 * where the provider has not worked it out, and where its own details
 * contradict it: conflicting information never reads as ready. Each
 * blocker names who can clear it, and what could not be read is listed
 * as unknown beside the verdict.
 */

/** Who can clear a blocker: the author pushes, reviewers review,
 *  maintainers change rules or settings, checks finish on their own. */
export type Resolver = 'author' | 'reviewers' | 'maintainers' | 'checks';

export interface ReadinessItem {
  kind:
    | 'draft'
    | 'conflicts'
    | 'behind'
    | 'checks'
    | 'reviews'
    | 'conversations'
    | 'rules';
  text: string;
  resolvedBy: Resolver;
}

export interface PullRequestReadiness {
  state: 'ready' | 'blocked' | 'unknown' | 'closed' | 'merged';
  /** What stops completion now. */
  blockers: ReadinessItem[];
  /** Visible problems nothing enforces: a failed optional check. */
  advisories: ReadinessItem[];
  /** What could not be read, or the provider has not worked out. */
  unknowns: string[];
}

export interface ReadinessInputs {
  merge: MergeState;
  checks: ReadOutcome<ListRead<PullRequestCheck>>;
  rules: ReadOutcome<BranchRules>;
  /** Unresolved review threads, where known. */
  unresolvedThreads: number | null;
}

interface Tally {
  blockers: ReadinessItem[];
  advisories: ReadinessItem[];
  unknowns: string[];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function names(checks: readonly PullRequestCheck[]): string {
  return checks.map((c) => c.name).join(', ');
}

const FAILED = new Set(['failed', 'cancelled']);
const WAITING = new Set(['queued', 'running', 'waiting', 'expected']);

function checksTally(inputs: ReadinessInputs, t: Tally): void {
  if (inputs.checks.state !== 'read') {
    t.unknowns.push('Checks');
    return;
  }
  const { items, complete } = inputs.checks.value;
  const required = items.filter((c) => c.requirement === 'required');
  const failing = required.filter((c) => FAILED.has(c.outcome));
  const waiting = required.filter((c) => WAITING.has(c.outcome));
  if (failing.length > 0) {
    t.blockers.push({
      kind: 'checks',
      text: `${plural(failing.length, 'required check')} failing: ${names(
        failing
      )}`,
      resolvedBy: 'author',
    });
  }
  if (waiting.length > 0) {
    t.blockers.push({
      kind: 'checks',
      text: `Waiting for ${plural(waiting.length, 'required check')}: ${names(
        waiting
      )}`,
      resolvedBy: 'checks',
    });
  }
  const other = items.filter(
    (c) => c.requirement !== 'required' && FAILED.has(c.outcome)
  );
  if (other.length > 0) {
    t.advisories.push({
      kind: 'checks',
      text: `${plural(other.length, 'check')} failing, not required: ${names(
        other
      )}`,
      resolvedBy: 'author',
    });
  }
  // Moot where the provider says nothing enforced is in the way.
  if (
    inputs.merge.blocked !== false &&
    items.some((c) => c.requirement === 'unknown')
  ) {
    t.unknowns.push('Whether every check is required');
  }
  const unread = required.filter((c) => c.outcome === 'unknown');
  if (unread.length > 0) {
    t.unknowns.push(`The outcome of ${names(unread)}`);
  }
  if (!complete) t.unknowns.push('Every check');
}

const REVIEW_BLOCKERS: Partial<Record<MergeState['reviews'], ReadinessItem>> = {
  'changes-requested': {
    kind: 'reviews',
    text: 'Changes requested',
    resolvedBy: 'author',
  },
  required: {
    kind: 'reviews',
    text: 'Waiting for review',
    resolvedBy: 'reviewers',
  },
};

/** An unstated requirement is moot where the provider says nothing it
 *  enforces is in the way: GitHub states none when none applies. */
function reviewsTally({ merge }: ReadinessInputs, t: Tally): void {
  const blocker = REVIEW_BLOCKERS[merge.reviews];
  if (blocker) t.blockers.push(blocker);
  if (merge.reviews === 'unknown' && merge.blocked !== false) {
    t.unknowns.push('The review requirement');
  }
}

/** Unresolved threads block where a rule says so and the provider does
 *  not say it is clear; otherwise they are there to read, not in the
 *  way. The count is the list's, older than the provider's verdict. */
function conversationsTally(inputs: ReadinessInputs, t: Tally): void {
  const open = inputs.unresolvedThreads;
  const enforced =
    inputs.rules.state === 'read'
      ? inputs.rules.value.conversationResolution
      : null;
  if (open == null) {
    if (enforced !== false) t.unknowns.push('Unresolved conversations');
    return;
  }
  if (open === 0) return;
  const item: ReadinessItem = {
    kind: 'conversations',
    text: `${plural(open, 'unresolved conversation')}`,
    resolvedBy: 'author',
  };
  if (enforced && inputs.merge.blocked !== false) t.blockers.push(item);
  else t.advisories.push(item);
  if (enforced == null && inputs.merge.blocked !== false) {
    t.unknowns.push('Whether conversations must be resolved');
  }
}

function mergeTally({ merge }: ReadinessInputs, t: Tally): void {
  if (merge.lifecycle.isDraft) {
    t.blockers.push({ kind: 'draft', text: 'Draft', resolvedBy: 'author' });
  }
  if (merge.conflicts === 'conflicting') {
    t.blockers.push({
      kind: 'conflicts',
      text: 'Conflicts with its target',
      resolvedBy: 'author',
    });
  } else if (merge.conflicts === 'unknown') {
    t.unknowns.push('Whether it conflicts with its target');
  }
  if (merge.behind) {
    t.blockers.push({
      kind: 'behind',
      text: 'Behind its target, which the rules require it to be up to date with',
      resolvedBy: 'author',
    });
  }
}

/** The provider says something blocks it; if nothing read names what,
 *  it is a rule n10 cannot see. If it does not say, or says it is clear
 *  while its details name a blocker, that is unknown. */
function enforcementTally({ merge }: ReadinessInputs, t: Tally): void {
  // A draft is the lifecycle's block, not one the provider enforces.
  const named = t.blockers.some((b) => b.kind !== 'draft');
  if (merge.blocked === true && !named) {
    t.blockers.push({
      kind: 'rules',
      text: 'Blocked by a rule n10 cannot see',
      resolvedBy: 'maintainers',
    });
  } else if (merge.blocked == null) {
    t.unknowns.push('Whether the provider will allow completion');
  } else if (merge.blocked === false && named) {
    t.unknowns.push(
      'Whether completion is allowed: the provider says so, its details do not'
    );
  }
}

/** The provider's verdict, unless its own details contradict it. A
 *  draft's own lifecycle is a verdict too. */
function verdict(merge: MergeState, t: Tally): 'ready' | 'blocked' | 'unknown' {
  if (merge.blocked === true || merge.lifecycle.isDraft) return 'blocked';
  if (merge.blocked === false && t.blockers.length === 0) return 'ready';
  return 'unknown';
}

export function evaluateReadiness(
  inputs: ReadinessInputs
): PullRequestReadiness {
  const { state } = inputs.merge.lifecycle;
  if (state !== 'open') {
    return {
      state: state === 'merged' ? 'merged' : 'closed',
      blockers: [],
      advisories: [],
      unknowns: [],
    };
  }
  const t: Tally = { blockers: [], advisories: [], unknowns: [] };
  mergeTally(inputs, t);
  checksTally(inputs, t);
  reviewsTally(inputs, t);
  conversationsTally(inputs, t);
  if (inputs.rules.state !== 'read') t.unknowns.push('Branch rules');
  enforcementTally(inputs, t);
  return { state: verdict(inputs.merge, t), ...t };
}
