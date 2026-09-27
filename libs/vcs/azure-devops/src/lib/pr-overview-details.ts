import {
  isOid,
  readFailure,
  VcsError,
  type DetailReviewer,
  type ListRead,
  type PullRequestDetail,
  type PullRequestIteration,
  type PullRequestLifecycle,
  type RepositoryRef,
} from '@n10/vcs-core';
import { authHeaders, baseUrl, type AdoConfig } from './client.js';
import { adoGet, TTL } from './request.js';
import { voteToDecision } from './votes.js';

/**
 * The selected pull request as Azure DevOps describes it: one read of
 * the pull request, with its reviewers, and one of its iterations. Read
 * for one pull request at a time, on demand — never per sidebar row,
 * whose cycle keeps its own budget (`request-budget.spec.ts`).
 */

interface RawIdentity {
  id?: string;
  displayName?: string;
  uniqueName?: string;
  isContainer?: boolean;
}

interface RawReviewer extends RawIdentity {
  vote?: number;
  hasDeclined?: boolean;
  isRequired?: boolean;
  /** The groups this reviewer's vote counted for. */
  votedFor?: RawIdentity[];
}

interface RawRepository {
  id?: string;
  name?: string;
  project?: { name?: string };
}

interface RawPullRequest {
  pullRequestId?: number;
  title?: string;
  status?: string;
  isDraft?: boolean;
  creationDate?: string;
  createdBy?: RawIdentity;
  sourceRefName?: string;
  targetRefName?: string;
  lastMergeSourceCommit?: { commitId?: string };
  lastMergeTargetCommit?: { commitId?: string };
  repository?: RawRepository;
  /** Present when the source branch lives in a fork. */
  forkSource?: { repository?: RawRepository };
  reviewers?: RawReviewer[];
}

interface RawIteration {
  id?: number;
  sourceRefCommit?: { commitId?: string };
  targetRefCommit?: { commitId?: string };
  commonRefCommit?: { commitId?: string };
}

const LIFECYCLE: Record<string, PullRequestLifecycle['state']> = {
  active: 'open',
  abandoned: 'closed',
  completed: 'merged',
};

function lifecycle(raw: RawPullRequest): PullRequestLifecycle {
  const state = LIFECYCLE[raw.status ?? ''];
  if (!state) {
    throw new VcsError(
      'unexpected-response',
      `Azure DevOps reported pull request ${raw.pullRequestId} as ${raw.status}, which n10 does not know`
    );
  }
  return { state, isDraft: raw.isDraft ?? false, native: raw.status ?? '' };
}

function branch(ref: string | undefined): string {
  return (ref ?? '').replace(/^refs\/heads\//, '');
}

function oid(commit: { commitId?: string } | undefined): string | null {
  return isOid(commit?.commitId) ? commit.commitId : null;
}

/** The configured repository, which is how the request named it, with
 *  the id Azure answered for it. */
function ownRepository(config: AdoConfig, raw: RawPullRequest): RepositoryRef {
  return {
    provider: 'azure-devops',
    host: `dev.azure.com/${config.org}`,
    repository: `${config.project}/${config.repo}`,
    ...(raw.repository?.id ? { id: raw.repository.id } : {}),
  };
}

/** Where the source branch lives: a fork, or the pull request's own
 *  repository. Null for a fork Azure no longer names. */
function sourceRepository(
  config: AdoConfig,
  raw: RawPullRequest
): RepositoryRef | null {
  if (!raw.forkSource) return ownRepository(config, raw);
  const fork = raw.forkSource.repository;
  if (!fork?.id || !fork.name || !fork.project?.name) return null;
  return {
    provider: 'azure-devops',
    host: `dev.azure.com/${config.org}`,
    repository: `${fork.project.name}/${fork.name}`,
    id: fork.id,
  };
}

/**
 * One listed reviewer, their vote kept as Azure cast it. Azure has no
 * review request apart from the list, so someone listed who has not
 * voted is asked; a group's vote is its members'. Azure does not record
 * which commit a vote was cast on.
 */
function reviewer(raw: RawReviewer): DetailReviewer | null {
  const identifier = raw.uniqueName || raw.id;
  if (!identifier) return null;
  const vote = raw.vote ?? 0;
  const declined = raw.hasDeclined ?? false;
  const required = raw.isRequired ?? false;
  return {
    kind: raw.isContainer ? 'team' : 'user',
    identifier,
    id: raw.id ?? null,
    displayName: raw.displayName || identifier,
    decision: voteToDecision(vote, declined),
    native: String(vote),
    requested: vote === 0 && !declined,
    required,
    reason: required ? 'policy' : null,
    onBehalfOf: (raw.votedFor ?? []).flatMap((g) =>
      g.uniqueName ? [g.uniqueName] : []
    ),
    reviewedHead: null,
  };
}

/** Azure lists every reviewer with the pull request; one it does not
 *  name is counted, and the list is not called whole. */
function reviewersOf(raw: RawPullRequest): ListRead<DetailReviewer> {
  const all = (raw.reviewers ?? []).map(reviewer);
  const items = all.filter((r): r is DetailReviewer => r !== null);
  const total = all.length;
  return items.length === total
    ? { items, total, complete: true }
    : { items, total, complete: false };
}

/** The iteration that pushed `head`, or null when Azure has none for it
 *  yet — a push that landed between the two reads. */
function iterationAt(
  iterations: readonly RawIteration[],
  head: string
): PullRequestIteration | null {
  const pushed = iterations.filter(
    (i) => i.id != null && oid(i.sourceRefCommit) === head
  );
  const last = pushed.at(-1);
  if (!last?.id) return null;
  return {
    id: last.id,
    source: head,
    target: oid(last.targetRefCommit),
    base: oid(last.commonRefCommit),
  };
}

function detailOf(
  config: AdoConfig,
  raw: RawPullRequest,
  iteration: PullRequestDetail['iteration']
): PullRequestDetail {
  const number = raw.pullRequestId ?? 0;
  const head = oid(raw.lastMergeSourceCommit);
  if (!head) {
    throw new VcsError(
      'unexpected-response',
      `Azure DevOps named no source commit for pull request ${number}`
    );
  }
  return {
    ref: { ...ownRepository(config, raw), number },
    title: raw.title ?? '',
    url: `https://dev.azure.com/${config.org}/${config.project}/_git/${config.repo}/pullrequest/${number}`,
    author: {
      identifier: raw.createdBy?.uniqueName ?? '',
      displayName: raw.createdBy?.displayName || 'Unknown',
    },
    lifecycle: lifecycle(raw),
    source: {
      branch: branch(raw.sourceRefName),
      repository: sourceRepository(config, raw),
      head,
    },
    target: {
      branch: branch(raw.targetRefName),
      head: oid(raw.lastMergeTargetCommit),
    },
    createdAt: raw.creationDate ?? null,
    // Azure keeps no time of the last change to a pull request.
    updatedAt: null,
    reviewers: { state: 'read', value: reviewersOf(raw) },
    iteration,
    capabilities: {
      update: {
        state: 'unknown',
        reason: 'Azure DevOps does not say whether this account may edit it',
      },
    },
  };
}

export async function fetchPullRequestDetailAzure(
  config: AdoConfig,
  prId: number
): Promise<PullRequestDetail> {
  const repo = `${config.org}/${config.project}/${config.repo}`;
  const headers = authHeaders(config.pat);
  const url = `${baseUrl(config)}/pullrequests/${prId}`;
  const [raw, iterations] = await Promise.all([
    adoGet<RawPullRequest>(
      'fetchPullRequestDetail',
      `${repo}/detail/${prId}`,
      TTL.detail,
      `${url}?api-version=7.1`,
      headers,
      `pull request ${prId}`
    ),
    // Its own outcome: the pull request stands without its iterations.
    adoGet<{ value?: RawIteration[] }>(
      'fetchPullRequestIterations',
      `${repo}/iterations/${prId}`,
      TTL.detail,
      `${url}/iterations?api-version=7.1`,
      headers,
      `iterations of pull request ${prId}`
    ).then(
      (res) => ({ state: 'read' as const, value: res.value ?? [] }),
      readFailure
    ),
  ]);
  const head = oid(raw.lastMergeSourceCommit) ?? '';
  const iteration: PullRequestDetail['iteration'] =
    iterations.state === 'read'
      ? { state: 'read', value: iterationAt(iterations.value, head) }
      : iterations;
  return detailOf(config, raw, iteration);
}
