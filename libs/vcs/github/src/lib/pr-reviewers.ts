import {
  isOid,
  VcsError,
  type DetailReviewer,
  type ListRead,
} from '@n10/vcs-core';
import { ghGraphQL } from './gh-graphql.js';
import { mapReviewState } from './gh-reviews.js';

/**
 * A pull request's reviewers as GitHub names them, each connection read
 * page by page to the end:
 *
 * - `latestOpinionatedReviews`: each account's standing verdict. A reply
 *   in a review thread is filed as a `COMMENTED` review, so the latest
 *   review alone would hide an approval GitHub still counts.
 * - `latestReviews`: everyone who reviewed, so someone who only
 *   commented is listed too, with no verdict.
 * - `reviewRequests`: every open request, people and teams.
 */

const ACTOR = '__typename login ... on Node { id } ... on User { name }';

const CONNECTIONS = {
  latestOpinionatedReviews: {
    cursor: 'opinionsCursor',
    query: 'PullRequestOpinionsPage',
    nodes: `author { ${ACTOR} } state commit { oid }
            onBehalfOf(first: 10) { nodes { combinedSlug } }`,
  },
  latestReviews: {
    cursor: 'reviewsCursor',
    query: 'PullRequestReviewsPage',
    nodes: `author { ${ACTOR} } state`,
  },
  reviewRequests: {
    cursor: 'requestsCursor',
    query: 'PullRequestRequestsPage',
    nodes: `asCodeOwner
            requestedReviewer {
              __typename
              ... on Node { id }
              ... on User { login name }
              ... on Bot { login }
              ... on Mannequin { login }
              ... on Team { combinedSlug name }
              ... on EnterpriseTeam { combinedSlug name }
            }`,
  },
} as const;

type Key = keyof typeof CONNECTIONS;
const KEYS = Object.keys(CONNECTIONS) as Key[];

function connection(key: Key): string {
  const { cursor, nodes } = CONNECTIONS[key];
  return `
        ${key}(first: 100, after: $${cursor}) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { ${nodes} }
        }`;
}

/** The reviewer connections, for the detail query's pull request. */
export const REVIEWER_FIELDS = KEYS.map(connection).join('');

/** The cursor variables `REVIEWER_FIELDS` takes. */
export const REVIEWER_CURSORS = KEYS.map(
  (k) => `$${CONNECTIONS[k].cursor}: String`
).join(', ');

function pageQuery(key: Key): string {
  const { cursor, query } = CONNECTIONS[key];
  return `
  query ${query}($owner: String!, $repo: String!, $number: Int!, $${cursor}: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {${connection(key)}
      }
    }
  }
`;
}

/** A connection is read at most this many pages deep — 1,000 reviewers
 *  — and reported incomplete past it rather than read forever. */
const MAX_PAGES = 10;

export interface Page<T> {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

interface Actor {
  /** `User`, `Bot`, `Mannequin`, …; a bot is not a person. */
  __typename?: string;
  login: string;
  id?: string;
  name?: string | null;
}

export interface OpinionNode {
  author: Actor | null;
  state: string;
  commit: { oid: string } | null;
  onBehalfOf: { nodes: ({ combinedSlug: string } | null)[] };
}

export interface ReviewNode {
  author: Actor | null;
  state: string;
}

export interface RequestNode {
  asCodeOwner: boolean;
  /** Null, or empty, for a reviewer this account may not see — a
   *  code-owner team in an organization it is not part of. */
  requestedReviewer: {
    __typename?: string;
    id?: string;
    login?: string;
    name?: string | null;
    combinedSlug?: string;
  } | null;
}

export interface ReviewerConnections {
  latestOpinionatedReviews: Page<OpinionNode>;
  latestReviews: Page<ReviewNode>;
  reviewRequests: Page<RequestNode>;
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

/** A reviewer before anything is known of them. */
const NOBODY: Omit<DetailReviewer, 'kind' | 'identifier' | 'displayName'> = {
  id: null,
  decision: 'no-response',
  native: null,
  requested: false,
  required: null,
  reason: null,
  onBehalfOf: [],
  reviewedHead: null,
};

/** GitHub says what an account is; only its `Bot` is not a person. */
function kindOf(typename: string | undefined): 'user' | 'bot' {
  return typename === 'Bot' ? 'bot' : 'user';
}

function person(actor: Actor | null) {
  if (!actor?.login) return null;
  return {
    kind: kindOf(actor.__typename),
    identifier: actor.login,
    id: actor.id ?? null,
    displayName: actor.name || actor.login,
  };
}

function verdict(node: OpinionNode): DetailReviewer | null {
  const who = person(node.author);
  if (!who) return null;
  const decision = mapReviewState(node.state);
  const judged = decision !== 'no-response' && isOid(node.commit?.oid);
  return {
    ...NOBODY,
    ...who,
    decision,
    native: node.state,
    onBehalfOf: node.onBehalfOf.nodes.flatMap((t) =>
      t ? [t.combinedSlug] : []
    ),
    reviewedHead: judged && node.commit ? node.commit.oid : null,
  };
}

/** Someone who reviewed without a standing verdict: a comment names a
 *  commit, but judges none. */
function commenter(node: ReviewNode): DetailReviewer | null {
  const who = person(node.author);
  if (!who) return null;
  return {
    ...NOBODY,
    ...who,
    decision: mapReviewState(node.state),
    native: node.state,
  };
}

function request(node: RequestNode): DetailReviewer | null {
  const who = node.requestedReviewer;
  const asked = {
    ...NOBODY,
    id: who?.id ?? null,
    requested: true,
    reason: node.asCodeOwner ? ('code-owner' as const) : null,
  };
  if (who?.combinedSlug) {
    const name = who.combinedSlug;
    return {
      ...asked,
      kind: 'team',
      identifier: name,
      displayName: who.name || name,
    };
  }
  if (!who?.login) return null;
  return {
    ...asked,
    kind: kindOf(who.__typename),
    identifier: who.login,
    displayName: who.name || who.login,
  };
}

/**
 * Everyone with a verdict, then everyone who only commented, then
 * everyone asked who has done neither: someone asked again after a
 * verdict keeps the verdict and is marked requested. Reviewers GitHub
 * will not name to this account are counted, not listed; each is in
 * `latestReviews` or `reviewRequests`, so those two are counted.
 */
function mergeReviewers(
  opinions: readonly OpinionNode[],
  reviews: readonly ReviewNode[],
  requests: readonly RequestNode[]
): { items: DetailReviewer[]; unnamed: number } {
  const byId = new Map<string, DetailReviewer>();
  const keep = (r: DetailReviewer | null) => {
    if (r && !byId.has(r.identifier.toLowerCase())) {
      byId.set(r.identifier.toLowerCase(), r);
    }
  };
  opinions.map(verdict).forEach(keep);
  const listed = reviews.map(commenter);
  listed.forEach(keep);
  const asked = requests.map(request);
  for (const r of asked) {
    const was = r && byId.get(r.identifier.toLowerCase());
    if (r && was) {
      byId.set(r.identifier.toLowerCase(), {
        ...was,
        requested: true,
        reason: r.reason,
        id: was.id ?? r.id,
      });
    } else keep(r);
  }
  const unnamed = [...listed, ...asked].filter((r) => r === null).length;
  return { items: [...byId.values()], unnamed };
}

interface PageResponse<K extends Key> {
  data: {
    repository: {
      pullRequest: Pick<ReviewerConnections, K> | null;
    } | null;
  };
}

function pages<K extends Key>(
  vars: { owner: string; repo: string; number: number },
  key: K
) {
  return async (cursor: string) => {
    const res = (await ghGraphQL(pageQuery(key), {
      ...vars,
      [CONNECTIONS[key].cursor]: cursor,
    })) as PageResponse<K>;
    const pr = res.data.repository?.pullRequest;
    if (!pr) {
      throw new VcsError(
        'not-found',
        `GitHub could not find ${vars.owner}/${vars.repo}#${vars.number} while reading its reviewers`
      );
    }
    return pr[key];
  };
}

export async function reviewersOf(
  vars: { owner: string; repo: string; number: number },
  first: ReviewerConnections
): Promise<ListRead<DetailReviewer>> {
  const [opinions, reviews, requests] = await Promise.all([
    restOf(
      first.latestOpinionatedReviews,
      pages(vars, 'latestOpinionatedReviews')
    ),
    restOf(first.latestReviews, pages(vars, 'latestReviews')),
    restOf(first.reviewRequests, pages(vars, 'reviewRequests')),
  ]);
  const { items, unnamed } = mergeReviewers(
    opinions.nodes,
    reviews.nodes,
    requests.nodes
  );
  // Someone can appear in several connections, so their counts do not
  // add up to a head count until all are read to the end.
  if (!(opinions.complete && reviews.complete && requests.complete)) {
    return { items, total: null, complete: false };
  }
  const total = items.length + unnamed;
  return unnamed === 0
    ? { items, total, complete: true }
    : { items, total, complete: false };
}
