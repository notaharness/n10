import {
  isOid,
  readFailure,
  VcsError,
  type CheckOutcome,
  type ListRead,
  type MergeState,
  type PullRequestCheck,
  type PullRequestChecks,
  type ReadOutcome,
} from '@n10/vcs-core';
import {
  latestStatuses,
  readPrStatuses,
  type AdoPrStatus,
} from './build-status.js';
import { authHeaders, type AdoConfig } from './client.js';
import {
  failureOf,
  lifecycle,
  ownRepository,
  readPullRequest,
  revision,
  type RawIteration,
  type RawPullRequest,
} from './pr-overview-details.js';
import {
  conversationsOf,
  isListed,
  policiesBlock,
  policyCheck,
  reviewersBlock,
  reviewsOf,
  rulesOf,
  statusNameOf,
  type RawEvaluation,
} from './pr-policies.js';
import { reviewRuleOf } from './pr-review-rule.js';
import { adoGet, TTL } from './request.js';

/**
 * What stands between an Azure DevOps pull request and completion: its
 * branch policies as Azure evaluates them, every status posted to it
 * (each check's newest word), and Azure's merge. Read for one pull
 * request at a time, on demand. The pull request, its iterations and
 * its statuses share their cache entries with the detail and the list,
 * so the cycle's budget is untouched (`request-budget.spec.ts`).
 */

/** Evaluations asked for in one page; a full page may not be all. */
const POLICY_PAGE = 100;

const STATUS_OUTCOME: Record<string, CheckOutcome> = {
  succeeded: 'succeeded',
  failed: 'failed',
  error: 'failed',
  pending: 'running',
  // Azure leaves `state` out for its zero value, `notSet`: queued.
  notSet: 'queued',
  // The check withdrew itself; its newest word stands.
  notApplicable: 'skipped',
};

function statusName(s: AdoPrStatus): string {
  const name = s.context?.name ?? '';
  return s.context?.genre ? `${s.context.genre}/${name}` : name;
}

/** A status as a check, on the commit its iteration pushed. */
function statusCheck(
  s: AdoPrStatus,
  heads: ReadonlyMap<number, string>,
  requirement: PullRequestCheck['requirement']
): PullRequestCheck {
  const native = s.state ?? 'notSet';
  const outcome = STATUS_OUTCOME[native] ?? 'unknown';
  const settled = outcome === 'succeeded' || outcome === 'failed';
  return {
    key: `status:${statusName(s)}`,
    kind: 'check',
    requires: null,
    name: statusName(s),
    group: null,
    source: s.createdBy?.displayName ?? null,
    outcome,
    native,
    requirement,
    revision: heads.get(s.iterationId ?? -1) ?? null,
    ranOn: null,
    startedAt: null,
    completedAt: settled ? s.updatedDate ?? s.creationDate ?? null : null,
    attempt: null,
    url: s.targetUrl ?? null,
  };
}

/** Each iteration's source commit, by iteration id. */
function headsOf(iterations: ReadOutcome<RawIteration[]>): Map<number, string> {
  const heads = new Map<number, string>();
  if (iterations.state !== 'read') return heads;
  for (const i of iterations.value) {
    const commit = i.sourceRefCommit?.commitId;
    if (i.id != null && isOid(commit)) heads.set(i.id, commit);
  }
  return heads;
}

async function readEvaluations(
  config: AdoConfig,
  raw: RawPullRequest,
  prId: number
): Promise<RawEvaluation[]> {
  const projectId = raw.repository?.project?.id;
  if (!projectId) {
    throw new VcsError(
      'unexpected-response',
      `Azure DevOps named no project for pull request ${prId}`
    );
  }
  const artifact = encodeURIComponent(
    `vstfs:///CodeReview/CodeReviewId/${projectId}/${prId}`
  );
  const data = await adoGet<{ value?: RawEvaluation[] }>(
    'fetchPolicyEvaluations',
    `${config.org}/${config.project}/${config.repo}/policies/${prId}`,
    TTL.detail,
    `https://dev.azure.com/${config.org}/${config.project}/_apis/policy/evaluations` +
      `?artifactId=${artifact}&$top=${POLICY_PAGE}&api-version=7.1-preview.1`,
    authHeaders(config.pat),
    `policies of pull request ${prId}`
  );
  const value = data.value ?? [];
  if (value.length >= POLICY_PAGE) {
    throw new VcsError(
      'unexpected-response',
      `Pull request ${prId} has more policies than n10 reads in one page`
    );
  }
  return value;
}

type Read<T> = ReadOutcome<T>;

const read = <T>(value: T) => ({ state: 'read' as const, value });

/** The Status policy that waits for each status, by `genre/name`. */
function coveringPolicies(
  policies: readonly RawEvaluation[]
): Map<string, number> {
  const covered = new Map<string, number>();
  policies.forEach((e, index) => {
    const name = statusNameOf(e);
    if (name) covered.set(name, index);
  });
  return covered;
}

/**
 * Every policy, then every status no Status policy speaks for. A
 * status a policy waits for is that policy's check, with the status's
 * link. With one of the two reads failed, the other's are listed and
 * the list is not called whole.
 */
function checksOf(
  config: AdoConfig,
  statuses: Read<AdoPrStatus[]>,
  evaluations: Read<RawEvaluation[]>,
  heads: ReadonlyMap<number, string>
): Read<ListRead<PullRequestCheck>> {
  if (statuses.state !== 'read' && evaluations.state !== 'read') {
    return statuses;
  }
  const policies =
    evaluations.state === 'read' ? evaluations.value.filter(isListed) : [];
  const latest =
    statuses.state === 'read' ? latestStatuses(statuses.value) : [];
  const covered = coveringPolicies(policies);
  const items = policies.map((e) => policyCheck(e, config));
  const requirement = evaluations.state === 'read' ? 'optional' : 'unknown';
  for (const s of latest) {
    const index = covered.get(statusName(s));
    if (index === undefined) items.push(statusCheck(s, heads, requirement));
    else items[index].url ??= s.targetUrl ?? null;
  }
  const complete = statuses.state === 'read' && evaluations.state === 'read';
  return read(
    complete
      ? { items, total: items.length, complete: true }
      : { items, total: null, complete: false }
  );
}

/** Merge outcomes that stop completion. */
const MERGE_FAILED = new Set(['conflicts', 'rejectedByPolicy', 'failure']);

/**
 * Azure's completion gate: a failed merge, a required reviewer who has
 * not approved or an unmet blocking policy stops it; every policy met
 * on a clean merge lets it through. Anything else is not yet decided.
 * A draft is its lifecycle's to say.
 */
function blockedOf(
  raw: RawPullRequest,
  evaluations: RawEvaluation[] | null
): boolean | null {
  const merge = raw.mergeStatus;
  if (MERGE_FAILED.has(merge ?? '')) return true;
  if (reviewersBlock(raw.reviewers ?? [])) return true;
  if (!evaluations) return null;
  if (policiesBlock(evaluations)) return true;
  return merge === 'succeeded' ? false : null;
}

function mergeOf(
  raw: RawPullRequest,
  evaluations: Read<RawEvaluation[]>
): MergeState {
  const merge = raw.mergeStatus;
  const policies = evaluations.state === 'read' ? evaluations.value : null;
  return {
    lifecycle: lifecycle(raw),
    conflicts:
      merge === 'succeeded'
        ? 'none'
        : merge === 'conflicts'
        ? 'conflicting'
        : 'unknown',
    // Azure has no rule that a pull request be up to date.
    behind: null,
    blocked: blockedOf(raw, policies),
    reviews: reviewsOf(policies, raw.reviewers ?? []),
    conversations: conversationsOf(policies),
    native: merge ?? null,
  };
}

export async function fetchPullRequestChecksAzure(
  config: AdoConfig,
  prId: number
): Promise<PullRequestChecks> {
  const { raw, iterations } = await readPullRequest(config, prId);
  const current = revision(
    raw,
    iterations.state === 'read' ? iterations.value : null
  );
  if (!current.head) {
    if (iterations.state !== 'read') throw failureOf(iterations);
    throw new VcsError(
      'unexpected-response',
      `Azure DevOps named no source commit for pull request ${prId}`
    );
  }
  const [statuses, evaluations] = await Promise.all([
    readPrStatuses(config, prId).then(read, readFailure),
    readEvaluations(config, raw, prId).then(read, readFailure),
  ]);
  return {
    ref: { ...ownRepository(config, raw), number: raw.pullRequestId ?? prId },
    head: current.head,
    checks: checksOf(config, statuses, evaluations, headsOf(iterations)),
    rules:
      evaluations.state === 'read'
        ? read({
            ...rulesOf(evaluations.value),
            reviews: reviewRuleOf(evaluations.value),
          })
        : evaluations,
    merge: mergeOf(raw, evaluations),
  };
}
