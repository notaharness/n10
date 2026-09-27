import {
  isOid,
  VcsError,
  type Capability,
  type DetailReviewer,
  type ListRead,
  type PullRequestDetail,
  type PullRequestLifecycle,
  type RepositoryRef,
} from '@n10/vcs-core';
import { ghGraphQL } from './gh-graphql.js';
import {
  REQUESTS,
  REVIEWS,
  reviewersOf,
  type Page,
  type RequestNode,
  type ReviewNode,
} from './pr-reviewers.js';

/**
 * The selected pull request as GitHub describes it: one query for the
 * pull request, then further pages of its reviews and review requests
 * until each connection is read to the end.
 *
 * This is read for one pull request at a time, on demand — never per
 * sidebar row, which the list query serves.
 */

const DETAIL_QUERY = `
  query PullRequestDetail($owner: String!, $repo: String!, $number: Int!, $reviewsCursor: String, $requestsCursor: String) {
    repository(owner: $owner, name: $repo) {
      id
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
        headRepository { id nameWithOwner }
        baseRefName
        baseRefOid${REVIEWS}${REQUESTS}
      }
    }
  }
`;

interface DetailNode {
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
  headRepository: { id: string; nameWithOwner: string } | null;
  baseRefName: string;
  baseRefOid: string | null;
  latestReviews: Page<ReviewNode>;
  reviewRequests: Page<RequestNode>;
}

interface DetailResponse {
  data: {
    repository: {
      id: string;
      nameWithOwner: string;
      pullRequest: DetailNode | null;
    } | null;
  };
}

function githubRepository(id: string, nameWithOwner: string): RepositoryRef {
  return {
    provider: 'github',
    host: 'github.com',
    repository: nameWithOwner,
    id,
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
  repository: { id: string; nameWithOwner: string },
  node: DetailNode,
  reviewers: ListRead<DetailReviewer>
): PullRequestDetail {
  if (!isOid(node.headRefOid)) {
    throw new VcsError(
      'unexpected-response',
      `GitHub named no head commit for ${repository.nameWithOwner}#${node.number}`
    );
  }
  return {
    ref: {
      ...githubRepository(repository.id, repository.nameWithOwner),
      number: node.number,
    },
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
        ? githubRepository(
            node.headRepository.id,
            node.headRepository.nameWithOwner
          )
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
    capabilities: { update: updateCapability(node.viewerCanUpdate) },
  };
}

export async function fetchPullRequestDetailGitHub(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestDetail> {
  const vars = { owner, repo, number };
  const res = (await ghGraphQL(DETAIL_QUERY, vars)) as DetailResponse;
  const repository = res.data.repository;
  const node = repository?.pullRequest;
  if (!repository || !node) {
    throw new VcsError(
      'not-found',
      `GitHub could not find ${owner}/${repo}#${number}, or this account cannot see it`
    );
  }
  return detailOf(repository, node, await reviewersOf(vars, node));
}
