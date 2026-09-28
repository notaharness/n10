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
  /** Provider-native identity: two apps, two workflows, or two jobs
   *  reporting one name are two checks. Stable across reads until the
   *  check runs again: a re-run is a new check. */
  key: string;
  /**
   * A check reports on the code: a run, a commit status, a build. A
   * policy is a rule the provider evaluates on the pull request itself
   * (Azure's work item linking). Reviews and conversations are not
   * listed either way: `MergeState` carries their verdicts.
   */
  kind: 'check' | 'policy';
  /** For an expected check, the requirement it stands for, with the
   *  app it must come from; null for one that reported. */
  requires: RequiredCheck | null;
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
  /** It waits for someone to start it: a build policy with a manual
   *  trigger that has not run on this revision. Absent otherwise. */
  manual?: boolean;
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

/**
 * Reviewers a rule names, some number of whom must approve: an Azure
 * DevOps required-reviewers policy, a GitHub rule set's required team.
 */
export interface NamedReviewers {
  /** The provider's ids for them: Azure DevOps identity ids, people or
   *  groups; GitHub team ids. Compared ignoring case. */
  ids: string[];
  /** Teams alone (GitHub's rule sets), or any identity. */
  kind: 'team' | 'identity';
  /** How many of them must approve; null where the rule asks each. */
  approvals: number | null;
  /** The file patterns the rule is limited to; empty for any change. */
  paths: string[];
  /** Completion waits for it. Azure DevOps also adds reviewers as
   *  optional, which asks for their review without requiring it. */
  blocking: boolean;
}

/** What the target branch's rules ask of reviews, in the provider's own
 *  terms: nothing here is inferred from who happens to be asked. */
export interface ReviewRule {
  /** Approvals needed, the most any rule asks; 0 where none sets a
   *  number. */
  approvals: number;
  /** A code owner of the changed files must approve (GitHub). */
  codeOwners: boolean;
  /** Reviewers a rule names, where it applies to this pull request. */
  named: NamedReviewers[];
}

/** What the target branch's rules ask of every pull request into it. */
export interface BranchRules {
  /** Checks that must pass, by name. */
  requiredChecks: RequiredCheck[];
  /** Review threads must be resolved; null where the rules that would
   *  say so could not be read. */
  conversationResolution: boolean | null;
  /** What reviews the rules ask for. */
  reviews: ReviewRule;
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
  /**
   * The provider's own verdict on what it enforces: something stands in
   * the way, named or not. Null where it has not worked it out. A draft
   * cannot complete whatever this says: its lifecycle says so.
   */
  blocked: boolean | null;
  /** The review requirement as the provider states it. */
  reviews:
    | 'approved'
    | 'changes-requested'
    | 'required'
    | 'not-required'
    | 'unknown';
  /**
   * The provider's own verdict on review threads, where a rule it
   * evaluates gives one (Azure's comment requirements policy); null
   * where it gives none, as GitHub does.
   */
  conversations: 'resolved' | 'unresolved' | null;
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
