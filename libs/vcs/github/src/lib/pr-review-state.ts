import {
  isVcsError,
  ReviewPublishError,
  type FiledReview,
} from '@n10/vcs-core';
import type { GraphQL } from './pr-review-match.js';
import { REVIEW_BY_ID, REVIEW_STATE } from './pr-review-queries.js';

/**
 * What GitHub says about a publication's review before anything is
 * sent: the pull request's head, the reviewer's pending review, and a
 * review's state and text once filed.
 */

export interface PendingReview {
  id: string;
  viewerDidAuthor: boolean;
  commit: { oid: string } | null;
  comments: { totalCount: number };
}

export interface PullRequestState {
  id: string;
  headRefOid: string;
  pending: PendingReview | null;
}

export async function readState(
  gql: GraphQL,
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestState> {
  const answer = (await gql(REVIEW_STATE, { owner, repo, number })) as {
    data?: {
      repository?: {
        pullRequest?: {
          id: string;
          headRefOid: string;
          reviews: { nodes: PendingReview[] };
        } | null;
      } | null;
    };
  };
  const pr = answer.data?.repository?.pullRequest;
  if (!pr) {
    throw new ReviewPublishError(
      'refused',
      `Pull request #${number} was not found`
    );
  }
  return {
    id: pr.id,
    headRefOid: pr.headRefOid,
    pending: pr.reviews.nodes.find((r) => r.viewerDidAuthor) ?? null,
  };
}

/** A review's state and text; null once it is gone, which GitHub
 *  answers with NOT_FOUND. */
export async function reviewById(
  gql: GraphQL,
  id: string
): Promise<FiledReview | null> {
  try {
    const answer = (await gql(REVIEW_BY_ID, { id })) as {
      data?: { node?: FiledReview | null };
    };
    const node = answer.data?.node;
    return node ? { state: node.state, body: node.body } : null;
  } catch (err) {
    if (isVcsError(err) && err.kind === 'not-found') return null;
    throw err;
  }
}
