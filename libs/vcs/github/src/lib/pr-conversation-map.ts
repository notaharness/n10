import type { RawEvent } from './pr-conversation-events.js';
import {
  isOid,
  sanitizeBody,
  type Capability,
  type ConversationActor,
  type ConversationComment,
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

export interface RawActor {
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
  viewerCannotUpdateReasons: string[];
  viewerCanDelete: boolean;
  /** `PENDING` while part of the viewer's unsubmitted review. */
  state: string;
  diffHunk: string;
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
  'replyTo' | 'pullRequestReview' | 'originalCommit' | 'state' | 'diffHunk'
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
  isMinimized: boolean;
  minimizedReason: string | null;
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

export function oidOf(value: { oid: string } | null | undefined): Oid | null {
  const oid = value?.oid;
  return isOid(oid) ? oid : null;
}

const SUPPORTED: Capability = { state: 'supported' };

function allowed(can: boolean, what: string): Capability {
  return can
    ? SUPPORTED
    : { state: 'forbidden', reason: `GitHub does not let you ${what}` };
}

/**
 * Why GitHub will not let the viewer edit a comment. Only a denial is
 * about the viewer; an archived or locked repository, maintenance or an
 * unverified email is something they cannot change here.
 */
const CANNOT_UPDATE: Record<string, string> = {
  ARCHIVED: 'The repository is archived',
  LOCKED: 'The conversation is locked',
  MAINTENANCE: 'GitHub is in maintenance',
  LOGIN_REQUIRED: 'GitHub needs you to sign in again',
  VERIFIED_EMAIL_REQUIRED: 'GitHub needs a verified email address',
};

function editCapability(raw: RawIssueComment): Capability {
  if (raw.viewerCanUpdate) return SUPPORTED;
  const reason = raw.viewerCannotUpdateReasons
    .map((r) => CANNOT_UPDATE[r])
    .find((r) => r !== undefined);
  return reason
    ? { state: 'unavailable', reason }
    : allowed(false, 'edit this comment');
}

function minimizedOf(raw: {
  isMinimized: boolean;
  minimizedReason: string | null;
}): ConversationComment['minimized'] {
  return raw.isMinimized
    ? { reason: raw.minimizedReason?.toLowerCase() ?? null }
    : null;
}

export function toActor(
  raw: RawActor | null | undefined
): ConversationActor | null {
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
    minimized: minimizedOf(raw),
    pending: 'state' in raw && raw.state === 'PENDING',
    replyTo: replyTo?.id ?? null,
    reviewId: review?.id ?? null,
    url: raw.url,
    capabilities: {
      edit: editCapability(raw),
      delete: allowed(raw.viewerCanDelete, 'delete this comment'),
    },
  };
}

type Side = 'LEFT' | 'RIGHT';

/** GitHub names one side per end; a single-line range has no start
 *  side, and a missing side is the new file's. */
function range(
  startSide: Side | null,
  side: Side | null,
  start: number | null,
  end: number | null
): LineRange | null {
  if (end == null) return null;
  const endSide = side ?? 'RIGHT';
  return {
    startSide: start == null ? endSide : startSide ?? endSide,
    start: start ?? end,
    side: endSide,
    end,
  };
}

export function toThread(
  raw: RawThread,
  comments: RawReviewComment[],
  coverage: Coverage
): ConversationThread {
  const isFile = raw.subjectType === 'FILE';
  const { startDiffSide: startSide, diffSide: side } = raw;
  const root = comments[0];
  return {
    id: raw.id,
    scope: isFile ? 'file' : 'line',
    anchor: {
      path: raw.path,
      current: isFile ? null : range(startSide, side, raw.startLine, raw.line),
      // GitHub keeps one pair of sides: a thread's sides do not change
      // as it is carried across pushes, only its line numbers.
      original: isFile
        ? null
        : range(startSide, side, raw.originalStartLine, raw.originalLine),
      originalCommit: oidOf(root?.originalCommit),
      iterations: null,
      diffHunk: root?.diffHunk || null,
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

/** GitHub's review states, a closed enum. The native word is kept
 *  beside the reading either way. */
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
    minimized: minimizedOf(raw),
    url: raw.url,
  };
}
