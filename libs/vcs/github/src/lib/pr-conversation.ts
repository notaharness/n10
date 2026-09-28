import {
  combineCoverage,
  coverageOf,
  type ConversationEvent,
  type ConversationThread,
  type Coverage,
  type PullRequestConversation,
  type PullRequestRef,
} from '@n10/vcs-core';
import { toEvent } from './pr-conversation-events.js';
import {
  toComment,
  toReview,
  toThread,
  type ConversationResponse,
  type Page,
  type PageInfo,
  type RawPullRequest,
  type RawThread,
  type RepliesResponse,
} from './pr-conversation-map.js';
import {
  CONNECTION_PAGE_QUERIES,
  CONVERSATION_QUERY,
  THREAD_REPLIES_QUERY,
  type ConnectionName,
} from './pr-conversation-queries.js';

/**
 * A GitHub pull request's whole conversation, read through GraphQL to
 * the end of every connection.
 *
 * One query reads the first page of everything, which is the whole
 * conversation for most pull requests. A connection with more pages is
 * continued by a query of its own, and so is a thread with more than a
 * hundred replies — the nested connection GitHub caps at a hundred per
 * page, where the older thread read stopped.
 */

export type GraphQl = (
  query: string,
  variables: Record<string, string | number>
) => Promise<unknown>;

/**
 * Pages read per connection before giving up. A pull request with more
 * than two thousand threads or comments is read that far and reported
 * incomplete, rather than holding the reader for hundreds of requests.
 */
export const PAGE_LIMIT = 20;

// ── Paging ────────────────────────────────────────────────────────

/**
 * The cursor for the next page, or undefined when the connection is
 * exhausted. GitHub can report `hasNextPage` with a null cursor, which
 * would fetch the same page forever, so both must hold.
 */
function nextCursor(pageInfo: PageInfo): string | undefined {
  return pageInfo.hasNextPage && pageInfo.endCursor
    ? pageInfo.endCursor
    : undefined;
}

interface Drained<T> {
  nodes: T[];
  coverage: Coverage;
}

/** Every node of a connection, from its first page on. */
async function drain<T>(
  first: Page<T>,
  next: (after: string) => Promise<Page<T> | undefined>
): Promise<Drained<T>> {
  const nodes: T[] = [];
  let page: Page<T> | undefined = first;
  let total: number | null = first.totalCount ?? null;
  let cursor: string | undefined;
  for (let read = 1; page; read++) {
    for (const node of page.nodes) if (node) nodes.push(node);
    total = page.totalCount ?? total;
    cursor = nextCursor(page.pageInfo);
    page = cursor && read < PAGE_LIMIT ? await next(cursor) : undefined;
  }
  return { nodes, coverage: coverageOf(nodes.length, total, !cursor) };
}

function missingPullRequest(ref: PullRequestRef): Error {
  return new Error(
    `GitHub has no pull request #${ref.number} in ${ref.repository}`
  );
}

export async function fetchGitHubConversation(
  graphql: GraphQl,
  ref: PullRequestRef
): Promise<PullRequestConversation> {
  const [owner, repo] = ref.repository.split('/');
  const vars = { owner: owner ?? '', repo: repo ?? '', number: ref.number };
  const read = async (query: string, extra = {}): Promise<RawPullRequest> => {
    const res = (await graphql(query, {
      ...vars,
      ...extra,
    })) as ConversationResponse;
    const pr = res.data.repository?.pullRequest;
    if (!pr) throw missingPullRequest(ref);
    return pr;
  };
  const first = await read(CONVERSATION_QUERY);
  const more =
    <K extends ConnectionName>(name: K) =>
    async (after: string) =>
      (await read(CONNECTION_PAGE_QUERIES[name], { after }))[name] as
        | RawPullRequest[K]
        | undefined;

  const [threads, comments, reviews, events] = await Promise.all([
    drain(first.reviewThreads!, more('reviewThreads')).then((d) =>
      withReplies(graphql, d)
    ),
    drain(first.comments!, more('comments')),
    drain(first.reviews!, more('reviews')),
    drain(first.timelineItems!, more('timelineItems')),
  ]);
  const mappedEvents = events.nodes
    .map(toEvent)
    .filter((e): e is ConversationEvent => e !== null);
  return {
    ref,
    threads: threads.threads,
    comments: comments.nodes.map(toComment),
    reviews: reviews.nodes.map(toReview),
    events: mappedEvents,
    coverage: {
      threads: threads.coverage,
      threadComments: combineCoverage(threads.threads.map((t) => t.coverage)),
      comments: comments.coverage,
      reviews: reviews.coverage,
      events: events.coverage,
    },
  };
}

/** Each thread with the replies past its first page read too. One
 *  thread at a time: a long thread is rare, and a burst of `gh`
 *  processes for them is not worth it. */
async function withReplies(
  graphql: GraphQl,
  drained: Drained<RawThread>
): Promise<{ threads: ConversationThread[]; coverage: Coverage }> {
  const threads: ConversationThread[] = [];
  for (const raw of drained.nodes) {
    const replies = await drain(raw.comments, async (after) => {
      const res = (await graphql(THREAD_REPLIES_QUERY, {
        thread: raw.id,
        after,
      })) as RepliesResponse;
      return res.data.node?.comments;
    });
    threads.push(toThread(raw, replies.nodes, replies.coverage));
  }
  return { threads, coverage: drained.coverage };
}
