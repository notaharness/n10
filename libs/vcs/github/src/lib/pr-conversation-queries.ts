/**
 * The GraphQL a pull request's conversation is read with: one query
 * for the first page of every connection, one per connection for the
 * pages after it, and one for a thread's replies past its first page.
 */

const ACTOR = `fragment ConversationActor on Actor { __typename login }`;

const REVIEW_COMMENT = `
fragment ConversationReviewComment on PullRequestReviewComment {
  id
  author { ...ConversationActor }
  body
  createdAt
  lastEditedAt
  isMinimized
  minimizedReason
  url
  replyTo { id }
  pullRequestReview { id }
  viewerCanUpdate
  viewerCannotUpdateReasons
  viewerCanDelete
  state
}`;

const THREAD = `
fragment ConversationThread on PullRequestReviewThread {
  id
  isResolved
  isOutdated
  path
  subjectType
  line
  startLine
  originalLine
  originalStartLine
  diffSide
  startDiffSide
  resolvedBy { ...ConversationActor }
  viewerCanReply
  viewerCanResolve
  viewerCanUnresolve
  root: comments(first: 1) { nodes { diffHunk originalCommit { oid } } }
  comments(first: 100) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes { ...ConversationReviewComment }
  }
}`;

const ISSUE_COMMENT = `
fragment ConversationIssueComment on IssueComment {
  id
  author { ...ConversationActor }
  body
  createdAt
  lastEditedAt
  isMinimized
  minimizedReason
  url
  viewerCanUpdate
  viewerCannotUpdateReasons
  viewerCanDelete
}`;

const REVIEW = `
fragment ConversationReview on PullRequestReview {
  id
  author { ...ConversationActor }
  state
  body
  submittedAt
  url
  commit { oid }
  comments { totalCount }
  isMinimized
  minimizedReason
}`;

/** The timeline entries that are events rather than comments or
 *  reviews, which have connections of their own. */
const EVENT_TYPES = [
  'PULL_REQUEST_COMMIT',
  'HEAD_REF_FORCE_PUSHED_EVENT',
  'BASE_REF_CHANGED_EVENT',
  'REVIEW_REQUESTED_EVENT',
  'REVIEW_REQUEST_REMOVED_EVENT',
  'REVIEW_DISMISSED_EVENT',
  'READY_FOR_REVIEW_EVENT',
  'CONVERT_TO_DRAFT_EVENT',
  'CLOSED_EVENT',
  'REOPENED_EVENT',
  'MERGED_EVENT',
].join(', ');

const REVIEWER = `
  requestedReviewer {
    __typename
    ... on User { login }
    ... on Bot { login }
    ... on Mannequin { login }
    ... on Team { name combinedSlug }
  }`;

const EVENT = `
fragment ConversationEvent on PullRequestTimelineItems {
  __typename
  ... on PullRequestCommit {
    id
    commit {
      oid
      committedDate
      messageHeadline
      author { name user { ...ConversationActor } }
    }
  }
  ... on HeadRefForcePushedEvent {
    id createdAt actor { ...ConversationActor }
    beforeCommit { oid } afterCommit { oid }
  }
  ... on BaseRefChangedEvent {
    id createdAt actor { ...ConversationActor }
    previousRefName currentRefName
  }
  ... on ReviewRequestedEvent {
    id createdAt actor { ...ConversationActor } ${REVIEWER}
  }
  ... on ReviewRequestRemovedEvent {
    id createdAt actor { ...ConversationActor } ${REVIEWER}
  }
  ... on ReviewDismissedEvent {
    id createdAt actor { ...ConversationActor } dismissalMessage
  }
  ... on ReadyForReviewEvent { id createdAt actor { ...ConversationActor } }
  ... on ConvertToDraftEvent { id createdAt actor { ...ConversationActor } }
  ... on ClosedEvent { id createdAt actor { ...ConversationActor } }
  ... on ReopenedEvent { id createdAt actor { ...ConversationActor } }
  ... on MergedEvent {
    id createdAt actor { ...ConversationActor } commit { oid }
  }
}`;

const PAGE = `pageInfo { hasNextPage endCursor }`;

const CONNECTIONS = {
  reviewThreads: {
    args: '',
    select: `totalCount ${PAGE} nodes { ...ConversationThread }`,
    fragments: [ACTOR, REVIEW_COMMENT, THREAD],
  },
  comments: {
    args: '',
    select: `totalCount ${PAGE} nodes { ...ConversationIssueComment }`,
    fragments: [ACTOR, ISSUE_COMMENT],
  },
  reviews: {
    args: '',
    select: `totalCount ${PAGE} nodes { ...ConversationReview }`,
    fragments: [ACTOR, REVIEW],
  },
  timelineItems: {
    args: `, itemTypes: [${EVENT_TYPES}]`,
    select: `${PAGE} nodes { ...ConversationEvent }`,
    fragments: [ACTOR, EVENT],
  },
} as const;

export type ConnectionName = keyof typeof CONNECTIONS;
const NAMES = Object.keys(CONNECTIONS) as ConnectionName[];

function fragmentsFor(names: readonly ConnectionName[]): string {
  return [...new Set(names.flatMap((n) => CONNECTIONS[n].fragments))].join(
    '\n'
  );
}

function connection(name: ConnectionName, after: string): string {
  const { args, select } = CONNECTIONS[name];
  return `${name}(first: 100${after}${args}) { ${select} }`;
}

/** The first page of every connection, in one request. */
export const CONVERSATION_QUERY = `
query PullRequestConversation($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${NAMES.map((n) => connection(n, '')).join('\n      ')}
    }
  }
}
${fragmentsFor(NAMES)}`;

/** A later page of one connection. */
export const CONNECTION_PAGE_QUERIES: Record<ConnectionName, string> =
  Object.fromEntries(
    NAMES.map((name) => [
      name,
      `
query PullRequestConversationPage($owner: String!, $repo: String!, $number: Int!, $after: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${connection(name, ', after: $after')}
    }
  }
}
${fragmentsFor([name])}`,
    ])
  ) as Record<ConnectionName, string>;

/** A later page of one thread's replies. */
export const THREAD_REPLIES_QUERY = `
query PullRequestThreadReplies($thread: ID!, $after: String!) {
  node(id: $thread) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $after) {
        totalCount
        ${PAGE}
        nodes { ...ConversationReviewComment }
      }
    }
  }
}
${ACTOR}
${REVIEW_COMMENT}`;
