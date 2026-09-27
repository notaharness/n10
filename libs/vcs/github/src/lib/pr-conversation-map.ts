import {
  isOid,
  sanitizeBody,
  type Capability,
  type ConversationActor,
  type ConversationComment,
  type ConversationEvent,
  type ConversationEventKind,
  type ConversationThread,
  type Coverage,
  type LineRange,
  type Oid,
  type ReviewState,
  type ReviewSummary,
} from '@n10/vcs-core';

/**
 * GitHub's conversation records as GraphQL returns them, and their
 * reading in the shared conversation vocabulary.
 */

// ── Wire shapes ───────────────────────────────────────────────────

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Page<T> {
  totalCount?: number;
  pageInfo: PageInfo;
  nodes: (T | null)[];
}

interface RawActor {
  __typename: string;
  login: string;
}

export interface RawReviewComment {
  id: string;
  author: RawActor | null;
  body: string;
  createdAt: string;
  lastEditedAt: string | null;
  isMinimized: boolean;
  minimizedReason: string | null;
  url: string;
  replyTo: { id: string } | null;
  pullRequestReview: { id: string } | null;
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
  originalCommit: { oid: string } | null;
}

export interface RawThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  subjectType: 'LINE' | 'FILE' | null;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  diffSide: 'LEFT' | 'RIGHT' | null;
  startDiffSide: 'LEFT' | 'RIGHT' | null;
  resolvedBy: RawActor | null;
  viewerCanReply: boolean;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  comments: Page<RawReviewComment>;
}

type RawIssueComment = Omit<
  RawReviewComment,
  'replyTo' | 'pullRequestReview' | 'originalCommit'
>;

interface RawReview {
  id: string;
  author: RawActor | null;
  state: string;
  body: string;
  submittedAt: string | null;
  url: string;
  commit: { oid: string } | null;
  comments: { totalCount: number };
}

interface RawEvent {
  __typename: string;
  id?: string;
  createdAt?: string;
  actor?: RawActor | null;
  commit?: {
    oid: string;
    committedDate?: string;
    author?: { name: string | null; user: RawActor | null } | null;
  } | null;
  beforeCommit?: { oid: string } | null;
  afterCommit?: { oid: string } | null;
  previousRefName?: string;
  currentRefName?: string;
  requestedReviewer?: {
    __typename: string;
    login?: string;
    name?: string;
  } | null;
  dismissalMessage?: string | null;
}

export interface RawPullRequest {
  reviewThreads?: Page<RawThread>;
  comments?: Page<RawIssueComment>;
  reviews?: Page<RawReview>;
  timelineItems?: Page<RawEvent>;
}

export interface ConversationResponse {
  data: { repository: { pullRequest: RawPullRequest | null } | null };
}

export interface RepliesResponse {
  data: { node: { comments?: Page<RawReviewComment> } | null };
}

// ── Mapping ───────────────────────────────────────────────────────

function oidOf(value: { oid: string } | null | undefined): Oid | null {
  const oid = value?.oid;
  return isOid(oid) ? oid : null;
}

const SUPPORTED: Capability = { state: 'supported' };

function allowed(can: boolean, what: string): Capability {
  return can
    ? SUPPORTED
    : { state: 'forbidden', reason: `GitHub does not let you ${what}` };
}

function toActor(raw: RawActor | null | undefined): ConversationActor | null {
  if (!raw?.login) return null;
  return {
    identifier: raw.login,
    displayName: raw.login,
    id: null,
    kind: raw.__typename === 'Bot' ? 'bot' : 'user',
  };
}

export function toComment(
  raw: RawReviewComment | RawIssueComment
): ConversationComment {
  const review = 'pullRequestReview' in raw ? raw.pullRequestReview : null;
  const replyTo = 'replyTo' in raw ? raw.replyTo : null;
  return {
    id: raw.id,
    author: toActor(raw.author),
    source: raw.body,
    body: sanitizeBody(raw.body),
    kind: 'text',
    createdAt: raw.createdAt,
    editedAt: raw.lastEditedAt,
    minimized: raw.isMinimized
      ? { reason: raw.minimizedReason?.toLowerCase() ?? null }
      : null,
    replyTo: replyTo?.id ?? null,
    reviewId: review?.id ?? null,
    url: raw.url,
    capabilities: {
      edit: allowed(raw.viewerCanUpdate, 'edit this comment'),
      delete: allowed(raw.viewerCanDelete, 'delete this comment'),
    },
  };
}

function range(
  side: 'LEFT' | 'RIGHT' | null,
  start: number | null,
  end: number | null
): LineRange | null {
  if (end == null) return null;
  return { side: side ?? 'RIGHT', start: start ?? end, end };
}

export function toThread(
  raw: RawThread,
  comments: RawReviewComment[],
  coverage: Coverage
): ConversationThread {
  const isFile = raw.subjectType === 'FILE';
  return {
    id: raw.id,
    scope: isFile ? 'file' : 'line',
    anchor: {
      path: raw.path,
      current: isFile ? null : range(raw.diffSide, raw.startLine, raw.line),
      original: isFile
        ? null
        : range(
            raw.startDiffSide ?? raw.diffSide,
            raw.originalStartLine,
            raw.originalLine
          ),
      originalCommit: oidOf(comments[0]?.originalCommit),
      iterations: null,
    },
    isOutdated: raw.isOutdated,
    status: {
      resolved: raw.isResolved,
      native: raw.isResolved ? 'resolved' : 'unresolved',
      resolvedBy: raw.isResolved ? toActor(raw.resolvedBy) : null,
    },
    comments: comments.map(toComment),
    coverage,
    capabilities: {
      reply: allowed(raw.viewerCanReply, 'reply to this thread'),
      resolve: raw.isResolved
        ? allowed(raw.viewerCanUnresolve, 'reopen this thread')
        : allowed(raw.viewerCanResolve, 'resolve this thread'),
    },
  };
}

const REVIEW_STATES: Record<string, ReviewState> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
  PENDING: 'pending',
};

export function toReview(raw: RawReview): ReviewSummary {
  return {
    id: raw.id,
    author: toActor(raw.author),
    state: REVIEW_STATES[raw.state] ?? 'commented',
    native: raw.state,
    source: raw.body,
    body: sanitizeBody(raw.body),
    submittedAt: raw.submittedAt,
    commit: oidOf(raw.commit),
    commentCount: raw.comments.totalCount,
    url: raw.url,
  };
}

const EVENT_KINDS: Record<string, ConversationEventKind> = {
  PullRequestCommit: 'commit',
  HeadRefForcePushedEvent: 'force-push',
  BaseRefChangedEvent: 'base-changed',
  ReviewRequestedEvent: 'review-requested',
  ReviewRequestRemovedEvent: 'review-request-removed',
  ReviewDismissedEvent: 'review-dismissed',
  ReadyForReviewEvent: 'ready-for-review',
  ConvertToDraftEvent: 'converted-to-draft',
  ClosedEvent: 'closed',
  ReopenedEvent: 'reopened',
  MergedEvent: 'merged',
};

/** A commit's author: the GitHub account where the commit is linked to
 *  one, else the name git recorded. */
function commitAuthor(raw: RawEvent): ConversationActor | null {
  const author = raw.commit?.author;
  const account = toActor(author?.user);
  if (account || !author?.name) return account;
  return {
    identifier: author.name,
    displayName: author.name,
    id: null,
    kind: 'user',
  };
}

function eventDetail(raw: RawEvent): Partial<ConversationEvent> {
  const reviewer = raw.requestedReviewer;
  const commit = oidOf(raw.commit);
  return {
    ...(commit ? { commit } : {}),
    ...(raw.__typename === 'HeadRefForcePushedEvent'
      ? { before: oidOf(raw.beforeCommit), after: oidOf(raw.afterCommit) }
      : {}),
    ...(reviewer ? { subject: reviewer.login ?? reviewer.name ?? '' } : {}),
  };
}

function eventText(raw: RawEvent): string | null {
  if (raw.__typename === 'BaseRefChangedEvent') {
    return `${raw.previousRefName ?? '?'} → ${raw.currentRefName ?? '?'}`;
  }
  return raw.dismissalMessage ?? null;
}

export function toEvent(raw: RawEvent): ConversationEvent | null {
  const kind = EVENT_KINDS[raw.__typename];
  const id = raw.id ?? raw.commit?.oid;
  if (!kind || !id) return null;
  const isCommit = raw.__typename === 'PullRequestCommit';
  return {
    id,
    kind,
    actor: isCommit ? commitAuthor(raw) : toActor(raw.actor),
    at: (isCommit ? raw.commit?.committedDate : raw.createdAt) ?? null,
    native: raw.__typename,
    text: eventText(raw),
    ...eventDetail(raw),
  };
}
