import type {
  ListRead,
  Oid,
  PullRequestLifecycle,
  PullRequestRef,
  ReadOutcome,
} from './pr-details.js';

/**
 * What stands between a pull request and completion, as its provider
 * reports it: every check on the head, what the target branch's rules
 * require, and the provider's own reading of mergeability and reviews.
 * Each is its own read; one that could not be read is a fact too.
 */

/** Whether the target branch's rules require a check. `unknown` where
 *  the provider does not say, never assumed either way. */
export type CheckRequirement = 'required' | 'optional' | 'unknown';

/**
 * A check's outcome in the shared vocabulary, in the CI overview's
 * words (`CiStatus`) so one status icon serves both. `expected` is a
 * required check nothing has reported on this revision yet — waiting,
 * as far as anyone can tell, not passing. `unknown` is an outcome the
 * provider named that n10 does not know: neither a pass nor a failure.
 */
export type CheckOutcome =
  | 'queued'
  | 'waiting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'neutral'
  | 'expected'
  | 'unknown';

export interface PullRequestCheck {
  /** Provider-native identity: two apps, two workflows, or one workflow
   *  run for two events, reporting one name are two checks. Stable
   *  across reads of one revision. */
  key: string;
  name: string;
  /** The workflow or pipeline it belongs to, where there is one. */
  group: string | null;
  /** Who reported it: an app (`github-actions`), a status's creator. */
  source: string | null;
  outcome: CheckOutcome;
  /** The provider's own words: `FAILURE`, `TIMED_OUT`, `error`… */
  native: string | null;
  requirement: CheckRequirement;
  /** The commit it reported on; null for one only expected. */
  revision: Oid | null;
  /**
   * The commit the provider handed the run: the revision itself, or a
   * test merge of it into the target (a GitHub Actions `pull_request`
   * run, Azure's build validation). What a job then checked out is its
   * own business. Null where the provider does not say.
   */
  ranOn: 'revision' | 'merge' | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Which attempt of its run, where the provider numbers them. */
  attempt: number | null;
  /** Where its details are, on the provider or the service that ran
   *  it. */
  url: string | null;
}

export interface RequiredCheck {
  name: string;
  /**
   * The app that must report it, where the rule names one: the
   * provider's id, and its name (`github-actions`) where a check on the
   * head shows it. Null where any reporter counts.
   */
  app: { id: string; slug: string | null } | null;
}

/** What the target branch's rules ask of every pull request into it. */
export interface BranchRules {
  /** Checks that must pass, by name. */
  requiredChecks: RequiredCheck[];
  /** Review threads must be resolved; null where the rules that would
   *  say so could not be read. */
  conversationResolution: boolean | null;
}

/**
 * The provider's own reading of whether the pull request can complete,
 * in shared terms. Null or `unknown` where the provider does not say,
 * or has not worked it out yet.
 */
export interface MergeState {
  lifecycle: PullRequestLifecycle;
  conflicts: 'none' | 'conflicting' | 'unknown';
  /** Behind its target where the rules require it up to date. */
  behind: boolean | null;
  /** The provider's own verdict: something it enforces stands in the
   *  way, named or not. Null where it has not worked it out. */
  blocked: boolean | null;
  /** The review requirement as the provider states it. */
  reviews:
    | 'approved'
    | 'changes-requested'
    | 'required'
    | 'not-required'
    | 'unknown';
  /** The provider's own word for the whole: `CLEAN`, `BLOCKED`… */
  native: string | null;
}

export interface PullRequestChecks {
  ref: PullRequestRef;
  /** The revision the checks are of. */
  head: Oid;
  checks: ReadOutcome<ListRead<PullRequestCheck>>;
  rules: ReadOutcome<BranchRules>;
  merge: MergeState;
}
