import {
  isOid,
  VcsError,
  type PullRequestRevisions,
  type RevisionEvent,
} from '@n10/vcs-core';

/**
 * A GitHub pull request's history: the commits it lists and every
 * force-push of its branch, from its timeline, plus the commit the
 * latest submitted review by the account `gh` answers as was on. One
 * GraphQL request.
 *
 * The timeline is read from its end, at most a page: a longer history
 * is marked incomplete rather than paged through, since "since my last
 * review" and "since my last visit" need its recent end. Reviews are
 * read from their end too, pending ones left out at the source, so an
 * unsent pending review never hides the submitted one before it. A
 * reply to a thread is sent as a review of its own — `COMMENTED`, no
 * body, one comment that replies — and is not counted as one: "since
 * my last review" must not follow the reader's last reply.
 */

export const REVISIONS_QUERY = `query PullRequestRevisions($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    id
    pullRequest(number: $number) {
      timelineItems(last: 100, itemTypes: [PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT]) {
        pageInfo { hasPreviousPage }
        nodes {
          __typename
          ... on PullRequestCommit { commit { oid committedDate } }
          ... on HeadRefForcePushedEvent { createdAt beforeCommit { oid } afterCommit { oid } }
        }
      }
      reviews(last: 100, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
        pageInfo { hasPreviousPage }
        nodes {
          state body viewerDidAuthor submittedAt commit { oid }
          comments(first: 1) { totalCount nodes { replyTo { id } } }
        }
      }
    }
  }
}`;

type GraphQL = (
  query: string,
  variables: Record<string, string | number>
) => Promise<unknown>;

interface TimelineNode {
  __typename?: string;
  commit?: { oid?: unknown; committedDate?: unknown } | null;
  createdAt?: unknown;
  beforeCommit?: { oid?: unknown } | null;
  afterCommit?: { oid?: unknown } | null;
}

interface Timeline {
  pageInfo?: { hasPreviousPage?: unknown };
  nodes?: (TimelineNode | null)[];
}

interface Review {
  state?: unknown;
  body?: unknown;
  viewerDidAuthor?: unknown;
  submittedAt?: unknown;
  commit?: { oid?: unknown } | null;
  comments?: {
    totalCount?: unknown;
    nodes?: ({ replyTo?: { id?: unknown } | null } | null)[];
  };
}

interface Reviews {
  pageInfo?: { hasPreviousPage?: unknown };
  nodes?: (Review | null)[];
}

interface Payload {
  data?: {
    viewer?: { login?: unknown } | null;
    repository?: {
      id?: unknown;
      pullRequest?: {
        timelineItems?: Timeline;
        reviews?: Reviews;
      } | null;
    } | null;
  };
}

const text = (value: unknown) => (typeof value === 'string' ? value : null);

/** A node the timeline returned, or null for one it has no oid for. */
function eventOf(node: TimelineNode): RevisionEvent | null {
  if (node.__typename === 'PullRequestCommit') {
    const oid = node.commit?.oid;
    return isOid(oid)
      ? { kind: 'commit', head: oid, at: text(node.commit?.committedDate) }
      : null;
  }
  if (node.__typename === 'HeadRefForcePushedEvent') {
    const head = node.afterCommit?.oid;
    const before = node.beforeCommit?.oid;
    return isOid(head)
      ? {
          kind: 'force-push',
          before: isOid(before) ? before : null,
          head,
          at: text(node.createdAt),
        }
      : null;
  }
  return null;
}

/** The page read, and whether it holds the whole timeline: it began
 *  at the start, and GitHub resolved every event in it. */
function timelineOf(
  timeline: Timeline | undefined
): Pick<PullRequestRevisions, 'events' | 'complete'> {
  const nodes = timeline?.nodes ?? [];
  const events = nodes.map((n) => (n ? eventOf(n) : null));
  return {
    events: events.filter((e) => e !== null),
    complete:
      timeline?.pageInfo?.hasPreviousPage === false &&
      events.every((e) => e !== null),
  };
}

/**
 * GitHub's review wrapping one reply to an existing thread, and nothing
 * else: a reply is sent as a review of its own, with one comment. A
 * review the reader submitted — with a summary, a new thread, or
 * several replies answered at once — counts. One reply submitted as a
 * whole review cannot be told apart, and does not count.
 */
function onlyReply(review: Review): boolean {
  if (review.state !== 'COMMENTED') return false;
  if (typeof review.body === 'string' && review.body.trim() !== '') {
    return false;
  }
  const [only] = review.comments?.nodes ?? [];
  return review.comments?.totalCount === 1 && only?.replyTo != null;
}

/** The newest review the viewer submitted, with its commit, and
 *  whether the reviews read reach back to the first. */
function lastReviewOf(
  reviews: Reviews | undefined
): Pick<PullRequestRevisions, 'lastReview' | 'reviewsComplete'> {
  const nodes = reviews?.nodes ?? [];
  const reviewsComplete = reviews?.pageInfo?.hasPreviousPage === false;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const review = nodes[i];
    if (!review || review.viewerDidAuthor !== true || onlyReply(review)) {
      continue;
    }
    // The newest counts, commit or not: an older one never stands in.
    const head = review.commit?.oid;
    return {
      lastReview: {
        head: isOid(head) ? head : null,
        at: text(review.submittedAt),
      },
      reviewsComplete,
    };
  }
  return { lastReview: null, reviewsComplete };
}

export async function readGitHubRevisions(
  graphql: GraphQL,
  project: { owner: string; repo: string },
  prId: number
): Promise<PullRequestRevisions> {
  const payload = (await graphql(REVISIONS_QUERY, {
    owner: project.owner,
    name: project.repo,
    number: prId,
  })) as Payload;
  const repository = payload.data?.repository;
  const pr = repository?.pullRequest;
  if (!repository || !pr) {
    throw new VcsError(
      'not-found',
      `No pull request #${prId} in ${project.owner}/${project.repo}`
    );
  }
  const id = text(repository.id);
  return {
    ref: {
      provider: 'github',
      host: 'github.com',
      repository: `${project.owner}/${project.repo}`,
      number: prId,
      ...(id ? { id } : {}),
    },
    ...timelineOf(pr.timelineItems),
    viewer: text(payload.data?.viewer?.login),
    ...lastReviewOf(pr.reviews),
  };
}
