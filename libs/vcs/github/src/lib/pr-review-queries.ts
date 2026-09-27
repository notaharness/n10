import type { ReviewPlace } from '@n10/vcs-core';

/**
 * The GraphQL a review publication sends, from GitHub's documented
 * schema: `addPullRequestReview` opens a pending review on a commit,
 * `addPullRequestReviewThread` and `addPullRequestReviewThreadReply`
 * add to it, `submitPullRequestReview` files it with its verdict.
 */

/** The pull request, its head, and the reviewer's own pending review
 *  (GitHub shows nobody else's) with what is in it. */
export const REVIEW_STATE = `query ReviewPublicationState($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      headRefOid
      reviews(states: [PENDING], first: 1) {
        nodes {
          id
          createdAt
          comments(first: 100) { nodes { id body path replyTo { id } } }
        }
      }
    }
  }
}`;

export const REVIEW_BY_ID = `query ReviewPublicationById($id: ID!) {
  node(id: $id) { ... on PullRequestReview { id state } }
}`;

export const START_REVIEW = `mutation StartReview($pr: ID!, $commit: GitObjectID!) {
  addPullRequestReview(input: { pullRequestId: $pr, commitOID: $commit }) {
    pullRequestReview { id }
  }
}`;

/**
 * A new thread in the pending review. `gh` cannot send a null
 * variable, so only the arguments the place uses are declared: a file
 * comment has no line, a one-line comment no start.
 */
export function addThreadMutation(
  place: Exclude<ReviewPlace, { kind: 'reply' }>
): string {
  const vars = ['$review: ID!', '$path: String!', '$body: String!'];
  const input = ['pullRequestReviewId: $review', 'path: $path', 'body: $body'];
  if (place.kind === 'file') {
    input.push('subjectType: FILE');
  } else {
    vars.push('$line: Int!', '$side: DiffSide!');
    input.push('line: $line', 'side: $side');
    if (place.range.start !== place.range.end) {
      vars.push('$startLine: Int!', '$startSide: DiffSide!');
      input.push('startLine: $startLine', 'startSide: $startSide');
    }
  }
  return `mutation AddReviewThread(${vars.join(', ')}) {
  addPullRequestReviewThread(input: { ${input.join(', ')} }) {
    thread { id comments(first: 1) { nodes { id } } }
  }
}`;
}

export const ADD_REPLY = `mutation AddReviewReply($review: ID!, $thread: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewId: $review, pullRequestReviewThreadId: $thread, body: $body }) {
    comment { id }
  }
}`;

export const UPDATE_COMMENT = `mutation UpdateReviewComment($id: ID!, $body: String!) {
  updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
    pullRequestReviewComment { id }
  }
}`;

export const SUBMIT_REVIEW = `mutation SubmitReview($review: ID!, $event: PullRequestReviewEvent!, $body: String!) {
  submitPullRequestReview(input: { pullRequestReviewId: $review, event: $event, body: $body }) {
    pullRequestReview { id state }
  }
}`;

export const DELETE_REVIEW = `mutation DeletePendingReview($review: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $review }) {
    pullRequestReview { id }
  }
}`;
