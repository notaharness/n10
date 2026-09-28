import {
  readinessAspects,
  type ReadinessAspect,
} from './pr-readiness-aspects.js';
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
 * the provider's (`MergeState.blocked`), and a draft's own lifecycle;
 * n10 adds none. It is unknown
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
    | 'policies'
    | 'reviews'
    | 'conversations'
    | 'rules';
  text: string;
  resolvedBy: Resolver;
  /** Nothing has failed: it waits for something to start or finish. */
  pending?: boolean;
}

export interface PullRequestReadiness {
  state: 'ready' | 'blocked' | 'unknown' | 'closed' | 'merged';
  /** What stops completion now. */
  blockers: ReadinessItem[];
  /** Visible problems nothing enforces: a failed optional check. */
  advisories: ReadinessItem[];
  /** What could not be read, or the provider has not worked out. */
  unknowns: string[];
  /** Each fact on its own row: lifecycle, reviews, checks, conflicts,
   *  conversations and merge permission. */
  aspects: ReadinessAspect[];
}

export interface ReadinessInputs {
  merge: MergeState;
  checks: ReadOutcome<ListRead<PullRequestCheck>>;
  rules: ReadOutcome<BranchRules>;
  /** Unresolved review threads, where known. */
  unresolvedThreads: number | null;
}

export interface ReadinessTally {
  blockers: ReadinessItem[];
  advisories: ReadinessItem[];
  unknowns: string[];
}

type Tally = ReadinessTally;

function count(n: number, [one, many]: Noun): string {
  return `${n} ${n === 1 ? one : many}`;
}

function plural(n: number, word: string): string {
  return count(n, [word, `${word}s`]);
}

function names(checks: readonly PullRequestCheck[]): string {
  return checks.map((c) => c.name).join(', ');
}

type Noun = readonly [one: string, many: string];

/** How each kind of item is spoken of, and what not passing is. */
const WORDS = {
  check: {
    kind: 'checks',
    required: ['required check', 'required checks'],
    other: ['check', 'checks'],
    fails: 'failing',
  },
  policy: {
    kind: 'policies',
    required: ['required policy', 'required policies'],
    other: ['policy', 'policies'],
    fails: 'not met',
  },
} as const satisfies Record<
  PullRequestCheck['kind'],
  {
    kind: ReadinessItem['kind'];
    required: Noun;
    other: Noun;
    fails: string;
  }
>;

const FAILED = new Set(['failed', 'cancelled']);
const WAITING = new Set(['queued', 'running', 'waiting', 'expected']);

/** One kind's failing and waiting requirements, and its failures
 *  nothing enforces. */
function kindTally(
  items: readonly PullRequestCheck[],
  words: (typeof WORDS)[keyof typeof WORDS],
  t: Tally
): void {
  const { kind, fails } = words;
  const required = items.filter((c) => c.requirement === 'required');
  const failing = required.filter((c) => FAILED.has(c.outcome));
  const going = required.filter((c) => WAITING.has(c.outcome));
  const waiting = going.filter((c) => !c.manual);
  const unstarted = going.filter((c) => c.manual);
  const other = items.filter(
    (c) => c.requirement !== 'required' && FAILED.has(c.outcome)
  );
  if (failing.length > 0) {
    t.blockers.push({
      kind,
      text: `${count(failing.length, words.required)} ${fails}: ${names(
        failing
      )}`,
      resolvedBy: 'author',
    });
  }
  if (waiting.length > 0) {
    t.blockers.push({
      kind,
      text: `Waiting for ${count(waiting.length, words.required)}: ${names(
        waiting
      )}`,
      resolvedBy: 'checks',
      pending: true,
    });
  }
  if (unstarted.length > 0) {
    t.blockers.push({
      kind,
      text: `Someone must start ${count(
        unstarted.length,
        words.required
      )}: ${names(unstarted)}`,
      resolvedBy: 'author',
      pending: true,
    });
  }
  if (other.length > 0) {
    t.advisories.push({
      kind,
      text: `${count(
        other.length,
        words.other
      )} ${fails}, not required: ${names(other)}`,
      resolvedBy: 'author',
    });
  }
}

function checksTally(inputs: ReadinessInputs, t: Tally): void {
  if (inputs.checks.state !== 'read') {
    t.unknowns.push('Checks');
    return;
  }
  const { items, complete } = inputs.checks.value;
  for (const kind of ['check', 'policy'] as const) {
    kindTally(
      items.filter((c) => c.kind === kind),
      WORDS[kind],
      t
    );
  }
  // Moot where the provider says nothing enforced is in the way.
  if (
    inputs.merge.blocked !== false &&
    items.some((c) => c.requirement === 'unknown')
  ) {
    t.unknowns.push('Whether every check is required');
  }
  const unread = items.filter(
    (c) => c.requirement === 'required' && c.outcome === 'unknown'
  );
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
    pending: true,
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

/** Whether the rules ask for threads to be resolved; null unread. */
function ruleOf(rules: ReadinessInputs['rules']): boolean | null {
  return rules.state === 'read' ? rules.value.conversationResolution : null;
}

/** Unresolved threads block where a rule says so and the provider does
 *  not say it is clear; otherwise they are there to read, not in the
 *  way. The count is the list's, older than the provider's verdict.
 *  Where the provider judges the rule itself (Azure's comment policy),
 *  its verdict stands. */
function conversationsTally(inputs: ReadinessInputs, t: Tally): void {
  const open = inputs.unresolvedThreads;
  const judged = inputs.merge.conversations;
  const item: ReadinessItem = {
    kind: 'conversations',
    text: open
      ? plural(open, 'unresolved conversation')
      : 'Unresolved conversations',
    resolvedBy: 'author',
  };
  if (judged === 'unresolved') {
    t.blockers.push(item);
    return;
  }
  const enforced = judged === 'resolved' ? false : ruleOf(inputs.rules);
  if (open == null) {
    // Moot where no rule asks, or the provider says it is clear.
    if (enforced !== false && inputs.merge.blocked !== false) {
      t.unknowns.push('Unresolved conversations');
    }
    return;
  }
  if (open === 0) return;
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
      aspects: [],
    };
  }
  const t: Tally = { blockers: [], advisories: [], unknowns: [] };
  mergeTally(inputs, t);
  checksTally(inputs, t);
  reviewsTally(inputs, t);
  conversationsTally(inputs, t);
  if (inputs.rules.state !== 'read') t.unknowns.push('Branch rules');
  enforcementTally(inputs, t);
  return {
    state: verdict(inputs.merge, t),
    ...t,
    aspects: readinessAspects(inputs, t),
  };
}
