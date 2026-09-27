import type { ReviewLedger } from '@n10/vcs-core';
import { REVIEW_COMMENTS, THREAD_ROOT } from './pr-review-queries.js';

/**
 * Finding in a pending review what a step whose answer was lost added:
 * every comment the review holds, and the one that says what was sent,
 * where it was sent.
 */

export type GraphQL = (
  query: string,
  variables: Record<string, string | number>
) => Promise<unknown>;

export interface PendingComment {
  id: string;
  body: string;
  path: string;
  line: number | null;
  startLine: number | null;
  subjectType: 'LINE' | 'FILE';
  replyTo: { id: string } | null;
}

interface CommentsPage {
  data?: {
    node?: {
      comments?: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: PendingComment[];
      };
    } | null;
  };
}

/** Every comment in the review, pending or filed, page by page. */
export async function reviewComments(
  gql: GraphQL,
  review: string
): Promise<PendingComment[]> {
  const all: PendingComment[] = [];
  let after: string | null = null;
  do {
    // `gh` cannot send a null variable: the first page names no cursor.
    const page = (await gql(REVIEW_COMMENTS, {
      id: review,
      ...(after ? { after } : {}),
    })) as CommentsPage;
    const comments = page.data?.node?.comments;
    if (!comments) break;
    all.push(...comments.nodes);
    after = comments.pageInfo.hasNextPage ? comments.pageInfo.endCursor : null;
  } while (after);
  return all;
}

/**
 * The comment a lost add put in the pending review: the same text in
 * the same place (a reply by the comment it answers, which is its
 * thread's first), and not one already recorded as another item's.
 */
export async function findSent(
  gql: GraphQL,
  comments: PendingComment[],
  sent: NonNullable<ReviewLedger['sending']>,
  recorded: Set<string>
): Promise<PendingComment | undefined> {
  const root =
    sent.place.kind === 'reply'
      ? await threadRoot(gql, sent.place.threadId)
      : null;
  return comments.find((c) => !recorded.has(c.id) && sameItem(c, sent, root));
}

async function threadRoot(gql: GraphQL, thread: string) {
  const answer = (await gql(THREAD_ROOT, { id: thread })) as {
    data?: { node?: { comments?: { nodes: { id: string }[] } } | null };
  };
  return answer.data?.node?.comments?.nodes[0]?.id ?? null;
}

/** Whether `c` is what `sent` added; `root` is the first comment of
 *  the thread a reply went to. */
export function sameItem(
  c: PendingComment,
  sent: NonNullable<ReviewLedger['sending']>,
  root: string | null = null
): boolean {
  const { place } = sent;
  if (c.body !== sent.body) return false;
  if (place.kind === 'reply') return root != null && c.replyTo?.id === root;
  if (c.replyTo != null || c.path !== place.path) return false;
  if (place.kind === 'file') return c.subjectType === 'FILE';
  const { start, end } = place.range;
  return (
    c.subjectType === 'LINE' && c.line === end && (c.startLine ?? end) === start
  );
}
