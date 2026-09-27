import type { ReviewPlace } from '@n10/vcs-core';

/**
 * The GraphQL a review publication sends, from GitHub's documented
 * schema: `addPullRequestReview` opens a pending review on a commit,
 * `addPullRequestReviewThread` and `addPullRequestReviewThreadReply`
 * add to it, `submitPullRequestReview` files it with its verdict.
 */

/** The pull request, its head, and the reviewer's pending review:
 *  whose it is and on which commit. */
export const REVIEW_STATE = `query ReviewPublicationState($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      headRefOid
      reviews(states: [PENDING], first: 10) {
        nodes { id createdAt viewerDidAuthor commit { oid } }
      }
    }
  }
}`;

/** One page of what a pending review holds, to find a lost comment. */
export const REVIEW_COMMENTS = `query ReviewPublicationComments($id: ID!, $after: String) {
  node(id: $id) {
    ... on PullRequestReview {
      comments(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id body path line subjectType replyTo { id } }
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

export const DELETE_COMMENT = `mutation DeleteReviewComment($id: ID!) {
  deletePullRequestReviewComment(input: { id: $id }) {
    pullRequestReview { id }
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

/** The variables `addThreadMutation(place)` declares. */
export function threadVariables(
  place: Exclude<ReviewPlace, { kind: 'reply' }>
): Record<string, string | number> {
  if (place.kind === 'file') return { path: place.path };
  const { range } = place;
  const one = range.start === range.end;
  return {
    path: place.path,
    line: range.end,
    side: range.side,
    ...(one ? {} : { startLine: range.start, startSide: range.startSide }),
  };
}

/** The comment an add answered with: a reply's, or a thread's first. */
export function commentIdOf(answer: unknown): string {
  const data = (answer as { data?: Record<string, unknown> }).data ?? {};
  const reply = data['addPullRequestReviewThreadReply'] as
    | { comment: { id: string } }
    | undefined;
  if (reply) return reply.comment.id;
  const thread = data['addPullRequestReviewThread'] as {
    thread: { comments: { nodes: { id: string }[] } };
  };
  return thread.thread.comments.nodes[0]!.id;
}
