import {
  isOid,
  type BranchRules,
  type CheckOutcome,
  type MergeState,
  type PullRequestCheck,
} from '@n10/vcs-core';

/**
 * A pull request's branch policies as Azure DevOps evaluates them. Azure
 * has no single "can complete" field. Its completion gate, as its docs
 * put it, is that "all required reviewers approved it and all required
 * branch policies are met": these evaluations, each approved, rejected
 * or still running, and the required reviewers' votes. Build and status
 * policies are listed as checks and the rest as policies, required
 * where Azure blocks on them. Reviewer and comment policies are not
 * listed: the review requirement and the conversation verdict are
 * theirs.
 */

/** Policy types, by the id Azure DevOps gives them in every
 *  organization. */
export const POLICY = {
  build: '0609b952-1397-4640-95ec-e00a01b2c241',
  status: 'cbdc66da-9728-4af8-aada-9a5a32e4a226',
  minimumReviewers: 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd',
  requiredReviewers: 'fd2167ab-b0be-447a-8ec8-39368250530e',
  comments: 'c6a1889d-b943-4856-b76f-9e46bb6b0df2',
} as const;

export interface RawEvaluation {
  evaluationId?: string;
  /** `queued`, `running`, `approved`, `rejected`, `notApplicable` or
   *  `broken`. */
  status?: string;
  startedDate?: string;
  completedDate?: string;
  configuration?: {
    id?: number;
    isEnabled?: boolean;
    isBlocking?: boolean;
    isDeleted?: boolean;
    type?: { id?: string; displayName?: string };
    settings?: {
      displayName?: string | null;
      /** A Status policy's name, as Azure's page shows it. */
      defaultDisplayName?: string | null;
      statusGenre?: string;
      statusName?: string;
      /** Minimum reviewers: completion is allowed despite a reviewer
       *  waiting for the author or rejecting. Off unless set. */
      allowDownvotes?: boolean;
      /** Build: someone must queue it; it never starts by itself. */
      manualQueueOnly?: boolean;
    };
  };
  /** What a build policy ran: its build, and the source commit it
   *  merged. */
  context?: {
    buildId?: number;
    buildDefinitionName?: string;
    isExpired?: boolean;
    /** The build ran on an earlier push than the head. */
    buildIsNotCurrent?: boolean;
    lastMergeSourceCommitId?: string;
  };
}

const OUTCOME: Record<string, CheckOutcome> = {
  queued: 'queued',
  running: 'running',
  approved: 'succeeded',
  rejected: 'failed',
  notApplicable: 'skipped',
  // The policy itself failed to run: not a pass.
  broken: 'failed',
};

const REVIEW_POLICIES: readonly string[] = [
  POLICY.minimumReviewers,
  POLICY.requiredReviewers,
];

/** Policies whose verdict is the review requirement's or the
 *  conversations', never listed. */
const VERDICT_POLICIES: readonly string[] = [
  ...REVIEW_POLICIES,
  POLICY.comments,
];

const CHECK_POLICIES: readonly string[] = [POLICY.build, POLICY.status];

/** Enabled and not deleted: a policy Azure applies. */
export function isActive(e: RawEvaluation): boolean {
  const c = e.configuration;
  return c?.isEnabled !== false && c?.isDeleted !== true;
}

/** Listed as a check or a policy: applied, and not a verdict another
 *  field carries. */
export function isListed(e: RawEvaluation): boolean {
  return isActive(e) && !VERDICT_POLICIES.includes(typeOf(e));
}

function blocking(e: RawEvaluation): boolean {
  return e.configuration?.isBlocking === true;
}

function typeOf(e: RawEvaluation): string {
  return e.configuration?.type?.id ?? '';
}

/** An approval whose build has expired no longer lets it complete. */
function expired(e: RawEvaluation): boolean {
  return e.status === 'approved' && e.context?.isExpired === true;
}

/** Whether the policy lets the pull request complete. */
export function satisfied(e: RawEvaluation): boolean {
  if (expired(e)) return false;
  return e.status === 'approved' || e.status === 'notApplicable';
}

/** The status a Status policy waits for, as `genre/name`. */
export function statusNameOf(e: RawEvaluation): string | null {
  const s = e.configuration?.settings;
  if (typeOf(e) !== POLICY.status || !s?.statusName) return null;
  return s.statusGenre ? `${s.statusGenre}/${s.statusName}` : s.statusName;
}

/** The name Azure's own page shows, the most specific first. */
function nameOf(e: RawEvaluation): string {
  const settings = e.configuration?.settings;
  const names = [
    settings?.displayName,
    settings?.defaultDisplayName,
    e.context?.buildDefinitionName,
    statusNameOf(e),
    e.configuration?.type?.displayName,
  ];
  return names.find((n): n is string => Boolean(n)) ?? 'Policy';
}

function requirementOf(e: RawEvaluation): PullRequestCheck['requirement'] {
  const b = e.configuration?.isBlocking;
  if (b == null) return 'unknown';
  return b ? 'required' : 'optional';
}

/** What a build policy ran: its build, and the source commit it
 *  merged, which may be an earlier push's. Other policies ran nothing. */
function ranFacts(
  e: RawEvaluation,
  where: { org: string; project: string }
): Pick<PullRequestCheck, 'source' | 'revision' | 'ranOn' | 'url'> {
  if (typeOf(e) !== POLICY.build) {
    return { source: 'Azure DevOps', revision: null, ranOn: null, url: null };
  }
  const merged = e.context?.lastMergeSourceCommitId;
  const buildId = e.context?.buildId;
  return {
    source: 'Azure Pipelines',
    revision: isOid(merged) ? merged : null,
    ranOn: 'merge',
    url: buildId
      ? `https://dev.azure.com/${where.org}/${where.project}/_build/results?buildId=${buildId}`
      : null,
  };
}

/**
 * "If you set the policy trigger to Manual, users must queue the build
 * themselves", and an expired approval is not re-queued either. Such a
 * build waits for a person until one is queued for this revision: a
 * queued evaluation with its current build is waiting for an agent.
 */
function waitsForSomeone(e: RawEvaluation): boolean {
  if (typeOf(e) !== POLICY.build) return false;
  if (e.configuration?.settings?.manualQueueOnly !== true) return false;
  if (expired(e)) return true;
  const build = e.context?.buildId;
  const current = build != null && e.context?.buildIsNotCurrent !== true;
  return e.status === 'queued' && !current;
}

function outcomeFacts(
  e: RawEvaluation
): Pick<PullRequestCheck, 'outcome' | 'native' | 'manual'> {
  const facts: Pick<PullRequestCheck, 'outcome' | 'native'> = expired(e)
    ? { outcome: 'queued', native: 'expired' }
    : {
        outcome: OUTCOME[e.status ?? ''] ?? 'unknown',
        native: e.status ?? null,
      };
  return waitsForSomeone(e) ? { ...facts, manual: true } : facts;
}

/** A build policy is one check per build it ran: a new build is a new
 *  check, as a re-run is on GitHub. */
function keyOf(e: RawEvaluation): string {
  const policy = e.configuration?.id ?? e.evaluationId ?? nameOf(e);
  const build = typeOf(e) === POLICY.build ? e.context?.buildId : undefined;
  return build != null ? `policy:${policy}:${build}` : `policy:${policy}`;
}

/** One policy as a check. */
export function policyCheck(
  e: RawEvaluation,
  where: { org: string; project: string }
): PullRequestCheck {
  return {
    key: keyOf(e),
    kind: CHECK_POLICIES.includes(typeOf(e)) ? 'check' : 'policy',
    // Each policy is itself the requirement, not a stand-in for one.
    requires: null,
    name: nameOf(e),
    group: e.configuration?.type?.displayName ?? null,
    ...outcomeFacts(e),
    requirement: requirementOf(e),
    ...ranFacts(e, where),
    startedAt: e.startedDate ?? null,
    completedAt: e.completedDate ?? null,
    attempt: null,
  };
}

/** The branch's rules, as its blocking policies state them. */
export function rulesOf(evaluations: readonly RawEvaluation[]): BranchRules {
  const required = evaluations.filter(
    (e) => isActive(e) && blocking(e) && CHECK_POLICIES.includes(typeOf(e))
  );
  return {
    // A build of a pipeline, or a status by name: no app is named.
    requiredChecks: required.map((e) => ({ name: nameOf(e), app: null })),
    conversationResolution: evaluations.some(
      (e) => isActive(e) && blocking(e) && typeOf(e) === POLICY.comments
    ),
  };
}

/** Some policy Azure blocks on is not yet satisfied. */
export function policiesBlock(evaluations: readonly RawEvaluation[]): boolean {
  return evaluations.some((e) => isActive(e) && blocking(e) && !satisfied(e));
}

export interface ReviewerVote {
  vote?: number;
  isRequired?: boolean;
}

/** 10 approves, 5 approves with suggestions. */
const approves = (r: ReviewerVote) => (r.vote ?? 0) >= 5;

/** Every required reviewer must approve before Azure completes it. */
export function reviewersBlock(reviewers: readonly ReviewerVote[]): boolean {
  return reviewers.some((r) => r.isRequired && !approves(r));
}

/**
 * A reviewer waiting for the author (-5) or rejecting (-10) holds it
 * where Azure counts that vote: a required reviewer's, or anyone's
 * under a minimum-reviewers policy that does not allow downvotes.
 */
function downvoted(
  policies: readonly RawEvaluation[],
  reviewers: readonly ReviewerVote[]
): boolean {
  const counted = policies.some(
    (e) =>
      typeOf(e) === POLICY.minimumReviewers &&
      e.configuration?.settings?.allowDownvotes !== true
  );
  return reviewers.some(
    (r) => (r.vote ?? 0) < 0 && (r.isRequired === true || counted)
  );
}

/**
 * The review requirement, as Azure states it: every required reviewer
 * approves and every blocking reviewer policy is met. Where it is not,
 * a downvote Azure counts is changes requested; otherwise it waits for
 * review. Null evaluations were not read: the policies' part is then
 * unknown.
 */
export function reviewsOf(
  evaluations: readonly RawEvaluation[] | null,
  reviewers: readonly ReviewerVote[]
): MergeState['reviews'] {
  const policies = (evaluations ?? []).filter(
    (e) => isActive(e) && blocking(e) && REVIEW_POLICIES.includes(typeOf(e))
  );
  if (reviewersBlock(reviewers) || !policies.every(satisfied)) {
    return downvoted(policies, reviewers) ? 'changes-requested' : 'required';
  }
  if (!evaluations) return 'unknown';
  const any = policies.length > 0 || reviewers.some((r) => r.isRequired);
  return any ? 'approved' : 'not-required';
}

/** Azure's own verdict on the threads, where a blocking comment
 *  requirements policy gives one: met, rejected, or not yet decided. */
export function conversationsOf(
  evaluations: readonly RawEvaluation[] | null
): MergeState['conversations'] {
  const policies = (evaluations ?? []).filter(
    (e) => isActive(e) && blocking(e) && typeOf(e) === POLICY.comments
  );
  if (policies.length === 0) return null;
  if (policies.every(satisfied)) return 'resolved';
  return policies.some((e) => e.status === 'rejected') ? 'unresolved' : null;
}
