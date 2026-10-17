import {
  isOid,
  readFailure,
  VcsError,
  type Capability,
  type PullRequestDetail,
  type PullRequestLifecycle,
  type RepositoryRef,
} from '@n10/vcs-core';
import { ghQuery } from './gh-graphql.js';
import {
  REVIEWER_CURSORS,
  REVIEWER_FIELDS,
  reviewersOf,
  type ReviewerConnections,
} from './pr-reviewers.js';

/**
 * The selected pull request as GitHub describes it: one query for the
 * pull request, then further pages of its reviews and review requests
 * until each connection is read to the end.
 *
 * A repository is identified by its `databaseId`, the number REST
 * calls `id`. Its node id is not stable: GitHub answers in a legacy or
 * a newer format depending on a request header.
 *
 * This is read for one pull request at a time, on demand — never per
 * sidebar row, which the list query serves.
 */

const DETAIL_QUERY = `
  query PullRequestDetail($owner: String!, $repo: String!, $number: Int!, ${REVIEWER_CURSORS}) {
    repository(owner: $owner, name: $repo) {
      databaseId
      nameWithOwner
      pullRequest(number: $number) {
        number
        title
        url
        state
        isDraft
        createdAt
        updatedAt
        viewerCanUpdate
        author { login ... on User { name } }
        headRefName
        headRefOid
        headRepository { databaseId nameWithOwner }
        baseRefName
        baseRefOid${REVIEWER_FIELDS}
      }
    }
  }
`;

interface Repository {
  databaseId: number;
  nameWithOwner: string;
}

interface DetailNode extends ReviewerConnections {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  viewerCanUpdate: boolean;
  author: { login: string; name?: string | null } | null;
  headRefName: string;
  headRefOid: string;
  headRepository: Repository | null;
  baseRefName: string;
  baseRefOid: string | null;
}

interface DetailResponse {
  data: {
    repository: (Repository & { pullRequest: DetailNode | null }) | null;
  };
}

function githubRepository(repository: Repository): RepositoryRef {
  return {
    provider: 'github',
    host: 'github.com',
    repository: repository.nameWithOwner,
    id: String(repository.databaseId),
  };
}

const LIFECYCLE: Record<string, PullRequestLifecycle['state']> = {
  OPEN: 'open',
  CLOSED: 'closed',
  MERGED: 'merged',
};

function lifecycle(node: DetailNode): PullRequestLifecycle {
  const state = LIFECYCLE[node.state];
  if (!state) {
    throw new VcsError(
      'unexpected-response',
      `GitHub reported pull request #${node.number} as ${node.state}, which n10 does not know`
    );
  }
  return { state, isDraft: node.isDraft, native: node.state };
}

function updateCapability(canUpdate: boolean): Capability {
  return canUpdate
    ? { state: 'supported' }
    : {
        state: 'forbidden',
        reason: 'Your GitHub account cannot edit this pull request',
      };
}

function detailOf(
  repository: Repository,
  node: DetailNode,
  reviewers: PullRequestDetail['reviewers']
): PullRequestDetail {
  if (!isOid(node.headRefOid)) {
    throw new VcsError(
      'unexpected-response',
      `GitHub named no head commit for ${repository.nameWithOwner}#${node.number}`
    );
  }
  return {
    ref: { ...githubRepository(repository), number: node.number },
    title: node.title,
    url: node.url,
    // A deleted account shows as GitHub's own "ghost".
    author: node.author
      ? {
          identifier: node.author.login,
          displayName: node.author.name || node.author.login,
        }
      : { identifier: 'ghost', displayName: 'ghost' },
    lifecycle: lifecycle(node),
    source: {
      branch: node.headRefName,
      repository: node.headRepository
        ? githubRepository(node.headRepository)
        : null,
      head: node.headRefOid,
    },
    target: {
      branch: node.baseRefName,
      head: isOid(node.baseRefOid) ? node.baseRefOid : null,
    },
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    reviewers,
    iteration: {
      state: 'unsupported',
      reason: 'GitHub names a revision by its head commit alone',
    },
    capabilities: { update: updateCapability(node.viewerCanUpdate) },
  };
}

export async function fetchPullRequestDetailGitHub(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestDetail> {
  const vars = { owner, repo, number };
  const res = (await ghQuery(DETAIL_QUERY, vars)) as DetailResponse;
  const repository = res.data.repository;
  const node = repository?.pullRequest;
  if (!repository || !node) {
    throw new VcsError(
      'not-found',
      `GitHub could not find ${owner}/${repo}#${number}, or this account cannot see it`
    );
  }
  // Every other field arrived with the first answer; a later reviewer
  // page that fails takes only the reviewers with it.
  const reviewers = await reviewersOf(vars, node).then(
    (value) => ({ state: 'read' as const, value }),
    readFailure
  );
  return detailOf(repository, node, reviewers);
}
