import type {
  BranchRules,
  CheckOutcome,
  MergeState,
  PullRequestCheck,
  PullRequestChecks,
  PullRequestInfo,
} from '@n10/vcs-core';
import { isOid, type PullRequestRef } from '@n10/vcs-core/pr-details';
import type { DemoCi, DemoJob, DemoTeam } from '../data/identity.js';

/**
 * A demo pull request's checks read, as GitHub's would describe it:
 * each job of its repository's workflows on the head, in the state the
 * row's CI rollup says, and the default branch's rules. The row moves
 * as the demo's agents push, and so does this.
 */

const ACTIONS = { id: '15368', slug: 'github-actions' };

const NO_CI: DemoCi = { jobs: [], approvals: 0, conversationResolution: false };

/** Every job passes, the first required one fails, or all are running;
 *  with no rollup yet, the required ones are only expected. */
function outcomeOf(
  status: PullRequestInfo['buildStatus'],
  job: DemoJob,
  failing: DemoJob | undefined
): CheckOutcome | null {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return job === failing ? 'failed' : 'succeeded';
  if (status === 'pending') return 'running';
  return job.required ? 'expected' : null;
}

const NATIVE: Partial<Record<CheckOutcome, string>> = {
  succeeded: 'SUCCESS',
  failed: 'FAILURE',
  running: 'IN_PROGRESS',
};

function checkOf(
  pr: PullRequestInfo,
  job: DemoJob,
  outcome: CheckOutcome,
  now: number
): PullRequestCheck {
  const requirement = job.required ? 'required' : 'optional';
  if (outcome === 'expected') {
    return {
      key: `expected:${ACTIONS.id}:${job.name}`,
      kind: 'check',
      requires: { name: job.name, app: ACTIONS },
      name: job.name,
      group: null,
      source: null,
      outcome,
      native: null,
      requirement,
      revision: null,
      ranOn: null,
      startedAt: null,
      completedAt: null,
      attempt: null,
      url: null,
    };
  }
  const done = outcome !== 'running';
  // A finished run ended a few minutes ago; a running one started one.
  const started = now - (done ? job.seconds + 300 : 60) * 1000;
  return {
    key: `check:${pr.id}:${job.workflow}:${job.name}`,
    kind: 'check',
    requires: null,
    name: job.name,
    group: job.workflow,
    source: ACTIONS.slug,
    outcome,
    native: NATIVE[outcome] ?? null,
    requirement,
    revision: isOid(pr.headSha) ? pr.headSha : null,
    ranOn: 'merge',
    startedAt: new Date(started).toISOString(),
    completedAt: done
      ? new Date(started + job.seconds * 1000).toISOString()
      : null,
    attempt: 1,
    url: `${pr.url}/checks`,
  };
}

function checksOf(
  pr: PullRequestInfo,
  ci: DemoCi,
  now: number
): PullRequestCheck[] {
  const failing = ci.jobs.find((j) => j.required);
  return ci.jobs.flatMap((job) => {
    const outcome = outcomeOf(pr.buildStatus, job, failing);
    return outcome ? [checkOf(pr, job, outcome, now)] : [];
  });
}

/** The teams GitHub asked to review this pull request, for its paths. */
export function teamsOn(pr: PullRequestInfo, ci: DemoCi): DemoTeam[] {
  return (ci.teams ?? []).filter((t) => t.requestedOn.includes(pr.id));
}

/** A required team still to approve: the demo's teams never do. */
const teamWaits = (pr: PullRequestInfo, ci: DemoCi) =>
  teamsOn(pr, ci).some((t) => t.approvals > 0);

/** GitHub's `reviewDecision`: stated only where the rules ask for
 *  approvals. */
function reviewsOf(pr: PullRequestInfo, ci: DemoCi): MergeState['reviews'] {
  if (ci.approvals === 0 && !ci.teams?.length) return 'unknown';
  const decisions = (pr.reviewers ?? []).map((r) => r.decision);
  if (decisions.includes('changes-requested')) return 'changes-requested';
  const approvals = decisions.filter((d) => d === 'approved').length;
  return approvals >= ci.approvals && !teamWaits(pr, ci)
    ? 'approved'
    : 'required';
}

/** GitHub's `mergeStateStatus` over what the demo holds, and what the
 *  provider makes of it. */
function mergeOf(
  pr: PullRequestInfo,
  ci: DemoCi,
  checks: PullRequestCheck[]
): MergeState {
  const reviews = reviewsOf(pr, ci);
  const blocked =
    checks.some(
      (c) => c.requirement === 'required' && c.outcome !== 'succeeded'
    ) ||
    (reviews !== 'unknown' && reviews !== 'approved') ||
    (ci.conversationResolution && (pr.activeCommentCount ?? 0) > 0);
  const unstable = checks.some((c) => c.outcome === 'failed');
  const native = blocked ? 'BLOCKED' : unstable ? 'UNSTABLE' : 'CLEAN';
  return {
    lifecycle: { state: 'open', isDraft: pr.isDraft ?? false, native: 'OPEN' },
    conflicts: 'none',
    behind: blocked ? null : false,
    blocked,
    reviews,
    conversations: null,
    native,
  };
}

function rulesOf(ci: DemoCi): BranchRules {
  const named = (ci.teams ?? []).map((t) => ({
    // The rules read gives the rule set's id, not its name.
    name: null,
    ids: [String(t.id)],
    kind: 'team' as const,
    approvals: t.approvals,
    paths: t.paths,
    applies: null,
    blocking: t.approvals > 0,
  }));
  return {
    requiredChecks: ci.jobs
      .filter((j) => j.required)
      .map((j) => ({ name: j.name, app: ACTIONS })),
    conversationResolution: ci.conversationResolution,
    // GitHub's rules state a count, and never whether it is met.
    reviews: {
      approvals: ci.approvals,
      codeOwners: false,
      named,
      approvalsMet: null,
    },
  };
}

export function demoChecks(
  pr: PullRequestInfo,
  ref: PullRequestRef,
  ci: DemoCi = NO_CI,
  now = Date.now()
): PullRequestChecks {
  const checks = checksOf(pr, ci, now);
  return {
    ref,
    head: isOid(pr.headSha) ? pr.headSha : '0'.repeat(40),
    checks: {
      state: 'read',
      value: { items: checks, total: checks.length, complete: true },
    },
    rules: { state: 'read', value: rulesOf(ci) },
    merge: mergeOf(pr, ci, checks),
  };
}
