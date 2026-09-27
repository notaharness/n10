import {
  isOid,
  VcsError,
  type DetailReviewer,
  type ListRead,
} from '@n10/vcs-core';
import { ghGraphQL } from './gh-graphql.js';
import { mapReviewState } from './gh-reviews.js';

/**
 * A pull request's reviewers as GitHub names them: each account's
 * latest review, and every open review request — people and teams —
 * with both connections read page by page to the end.
 */

export const REVIEWS = `
        latestReviews(first: 100, after: $reviewsCursor) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            author { login ... on User { name } }
            state
            commit { oid }
          }
        }`;

export const REQUESTS = `
        reviewRequests(first: 100, after: $requestsCursor) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            requestedReviewer {
              __typename
              ... on User { login name }
              ... on Bot { login }
              ... on Mannequin { login }
              ... on Team { slug name organization { login } }
            }
          }
        }`;

const REVIEWS_PAGE_QUERY = `
  query PullRequestReviewsPage($owner: String!, $repo: String!, $number: Int!, $reviewsCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {${REVIEWS}
      }
    }
  }
`;

const REQUESTS_PAGE_QUERY = `
  query PullRequestRequestsPage($owner: String!, $repo: String!, $number: Int!, $requestsCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {${REQUESTS}
      }
    }
  }
`;

/** A connection is read at most this many pages deep — 1,000 reviewers
 *  — and reported incomplete past it rather than read forever. */
const MAX_PAGES = 10;

export interface Page<T> {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

export interface ReviewNode {
  author: { login: string; name?: string | null } | null;
  state: string;
  commit: { oid: string } | null;
}

export interface RequestNode {
  requestedReviewer: {
    __typename: string;
    login?: string;
    name?: string | null;
    slug?: string;
    organization?: { login: string };
  } | null;
}

interface PageResponse<K extends string, T> {
  data: {
    repository: { pullRequest: Record<K, Page<T>> | null } | null;
  };
}

/**
 * Every page after the first of one connection. `more` reads the page
 * after a cursor; the answer says whether it reached the end.
 */
async function restOf<T>(
  first: Page<T>,
  more: (cursor: string) => Promise<Page<T>>
): Promise<{ nodes: T[]; complete: boolean }> {
  const nodes = [...first.nodes];
  let page = first;
  for (let read = 1; page.pageInfo.hasNextPage; read++) {
    const cursor = page.pageInfo.endCursor;
    if (read >= MAX_PAGES || !cursor) return { nodes, complete: false };
    page = await more(cursor);
    nodes.push(...page.nodes);
  }
  return { nodes, complete: true };
}

function reviewer(node: ReviewNode): DetailReviewer | null {
  if (!node.author) return null;
  return {
    kind: 'user',
    identifier: node.author.login,
    displayName: node.author.name || node.author.login,
    decision: mapReviewState(node.state),
    native: node.state,
    requested: false,
    required: null,
    reviewedHead: isOid(node.commit?.oid) ? node.commit.oid : null,
  };
}

function requested(node: RequestNode): DetailReviewer | null {
  const who = node.requestedReviewer;
  if (!who) return null;
  const base = {
    decision: 'no-response',
    native: null,
    requested: true,
    required: null,
    reviewedHead: null,
  } as const;
  if (who.__typename === 'Team' && who.slug && who.organization) {
    return {
      ...base,
      kind: 'team',
      identifier: `${who.organization.login}/${who.slug}`,
      displayName: who.name || who.slug,
    };
  }
  if (!who.login) return null;
  return {
    ...base,
    kind: 'user',
    identifier: who.login,
    displayName: who.name || who.login,
  };
}

/**
 * Everyone who reviewed, then everyone asked who has not: someone asked
 * again after a verdict keeps the verdict and is marked requested.
 */
function mergeReviewers(
  reviews: readonly ReviewNode[],
  requests: readonly RequestNode[]
): DetailReviewer[] {
  const byId = new Map<string, DetailReviewer>();
  for (const r of reviews.map(reviewer)) {
    if (r) byId.set(r.identifier.toLowerCase(), r);
  }
  for (const r of requests.map(requested)) {
    if (!r) continue;
    const key = r.identifier.toLowerCase();
    const reviewed = byId.get(key);
    byId.set(key, reviewed ? { ...reviewed, requested: true } : r);
  }
  return [...byId.values()];
}

export async function reviewersOf(
  vars: { owner: string; repo: string; number: number },
  node: {
    latestReviews: Page<ReviewNode>;
    reviewRequests: Page<RequestNode>;
  }
): Promise<ListRead<DetailReviewer>> {
  const pullRequest = async <K extends 'latestReviews' | 'reviewRequests', T>(
    query: string,
    key: K,
    cursor: Record<string, string>
  ): Promise<Page<T>> => {
    const res = (await ghGraphQL(query, {
      ...vars,
      ...cursor,
    })) as PageResponse<K, T>;
    const page = res.data.repository?.pullRequest?.[key];
    if (!page) {
      throw new VcsError(
        'not-found',
        `GitHub could not find ${vars.owner}/${vars.repo}#${vars.number} while reading its reviewers`
      );
    }
    return page;
  };
  const [reviews, requests] = await Promise.all([
    restOf(node.latestReviews, (c) =>
      pullRequest<'latestReviews', ReviewNode>(
        REVIEWS_PAGE_QUERY,
        'latestReviews',
        {
          reviewsCursor: c,
        }
      )
    ),
    restOf(node.reviewRequests, (c) =>
      pullRequest<'reviewRequests', RequestNode>(
        REQUESTS_PAGE_QUERY,
        'reviewRequests',
        { requestsCursor: c }
      )
    ),
  ]);
  const items = mergeReviewers(reviews.nodes, requests.nodes);
  const complete = reviews.complete && requests.complete;
  // Someone can appear in both connections, so their counts do not add
  // up to a head count until both are read to the end.
  return { items, total: complete ? items.length : null, complete };
}
