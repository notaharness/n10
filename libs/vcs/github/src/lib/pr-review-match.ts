import type { ReviewLedger } from '@n10/vcs-core';
import { REVIEW_COMMENTS } from './pr-review-queries.js';

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

/** Every comment in the pending review, page by page. */
export async function pendingComments(
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

/** Whether `c` is what `sent` added: the same text, in the same place. */
export function sameItem(
  c: PendingComment,
  sent: NonNullable<ReviewLedger['sending']>
): boolean {
  const { place } = sent;
  if (c.body !== sent.body) return false;
  if (place.kind === 'reply') return c.replyTo != null;
  if (c.replyTo != null || c.path !== place.path) return false;
  if (place.kind === 'file') return c.subjectType === 'FILE';
  return c.subjectType === 'LINE' && c.line === place.range.end;
}
