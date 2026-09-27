import {
  coverageOf,
  sanitizeBody,
  type Capability,
  type ConversationActor,
  type ConversationComment,
  type ConversationEvent,
  type ConversationEventKind,
  type ConversationThread,
  type LineRange,
  type PullRequestConversation,
  type PullRequestRef,
} from '@n10/vcs-core';

/**
 * An Azure DevOps pull request's conversation, read from its threads.
 *
 * Azure keeps everything in one list: people's threads, and its own
 * history — votes, pushes, reviewer and status changes — as threads
 * holding only system comments. The first become threads here and the
 * second events, so automation is never shown as someone speaking. The
 * threads endpoint is not paged: one answer is every thread, so the
 * coverage is complete by construction.
 */

interface RawLine {
  line?: number;
}

interface RawIdentity {
  id?: string;
  displayName?: string;
  uniqueName?: string;
}

interface RawComment {
  id?: number;
  parentCommentId?: number;
  author?: RawIdentity;
  content?: string;
  publishedDate?: string;
  lastContentUpdatedDate?: string;
  commentType?: string;
  isDeleted?: boolean;
}

export interface RawAdoThread {
  id?: number;
  status?: string;
  publishedDate?: string;
  isDeleted?: boolean;
  threadContext?: {
    filePath?: string;
    leftFileStart?: RawLine;
    leftFileEnd?: RawLine;
    rightFileStart?: RawLine;
    rightFileEnd?: RawLine;
  } | null;
  pullRequestThreadContext?: {
    iterationContext?: {
      firstComparingIteration?: number;
      secondComparingIteration?: number;
    };
    trackingCriteria?: {
      origLeftFileStart?: RawLine;
      origLeftFileEnd?: RawLine;
      origRightFileStart?: RawLine;
      origRightFileEnd?: RawLine;
    };
  } | null;
  comments?: RawComment[];
  /** Values arrive wrapped with their .NET type: `{ $type, $value }`. */
  properties?: Record<string, { $value?: unknown } | undefined> | null;
  /** The people a system thread's properties name, keyed by the
   *  string the property holds. */
  identities?: Record<string, RawIdentity> | null;
}

/** Turns a raw comment body into display text: escape sequences out,
 *  `@<GUID>` mentions resolved to names where they can be. */
export type DisplayText = (source: string) => string;

const UNKNOWN_PERMISSION: Capability = {
  state: 'unknown',
  reason: 'Azure DevOps does not say what you may do with a thread',
};

function toActor(raw: RawIdentity | undefined): ConversationActor | null {
  const identifier = raw?.uniqueName ?? raw?.displayName;
  if (!raw || !identifier) return null;
  return {
    identifier,
    displayName: raw.displayName ?? identifier,
    id: raw.id ?? null,
    kind: 'user',
  };
}

function toComment(raw: RawComment, display: DisplayText): ConversationComment {
  const source = raw.content ?? '';
  const published = raw.publishedDate ?? '';
  const edited = raw.lastContentUpdatedDate;
  return {
    id: String(raw.id ?? ''),
    author: toActor(raw.author),
    source,
    body: display(source),
    kind: raw.commentType === 'system' ? 'system' : 'text',
    createdAt: published,
    editedAt: edited && edited !== published ? edited : null,
    minimized: null,
    replyTo: raw.parentCommentId ? String(raw.parentCommentId) : null,
    reviewId: null,
    url: null,
    capabilities: { edit: UNKNOWN_PERMISSION, delete: UNKNOWN_PERMISSION },
  };
}

/** A range from Azure's four line refs. Right wins: a thread with only
 *  left-side refs is on a deleted or old line. */
function rangeOf(
  leftStart: RawLine | undefined,
  leftEnd: RawLine | undefined,
  rightStart: RawLine | undefined,
  rightEnd: RawLine | undefined
): LineRange | null {
  if (rightStart?.line != null) {
    const start = rightStart.line;
    return { side: 'RIGHT', start, end: rightEnd?.line ?? start };
  }
  if (leftStart?.line != null) {
    const start = leftStart.line;
    return { side: 'LEFT', start, end: leftEnd?.line ?? start };
  }
  return null;
}

/** Azure's resolved statuses. `pending` is open: the author has not
 *  decided. */
const RESOLVED = new Set(['fixed', 'wontFix', 'closed', 'byDesign']);

function anchorOf(raw: RawAdoThread): ConversationThread['anchor'] {
  const ctx = raw.threadContext;
  if (!ctx?.filePath) return null;
  const orig = raw.pullRequestThreadContext?.trackingCriteria ?? {};
  const iteration = raw.pullRequestThreadContext?.iterationContext;
  const first = iteration?.firstComparingIteration;
  const second = iteration?.secondComparingIteration;
  return {
    path: ctx.filePath.replace(/^\//, ''),
    current: rangeOf(
      ctx.leftFileStart,
      ctx.leftFileEnd,
      ctx.rightFileStart,
      ctx.rightFileEnd
    ),
    original: rangeOf(
      orig.origLeftFileStart,
      orig.origLeftFileEnd,
      orig.origRightFileStart,
      orig.origRightFileEnd
    ),
    originalCommit: null,
    iterations: first != null && second != null ? { first, second } : null,
  };
}

function scopeOf(
  anchor: ConversationThread['anchor']
): ConversationThread['scope'] {
  if (!anchor) return 'general';
  return anchor.current || anchor.original ? 'line' : 'file';
}

function toThread(
  raw: RawAdoThread,
  comments: RawComment[],
  display: DisplayText
): ConversationThread {
  const anchor = anchorOf(raw);
  const native = raw.status ?? 'unknown';
  return {
    id: String(raw.id ?? ''),
    scope: scopeOf(anchor),
    anchor,
    // Azure could no longer place it: only the original range is left.
    isOutdated: anchor != null && !anchor.current && anchor.original != null,
    status: { resolved: RESOLVED.has(native), native, resolvedBy: null },
    comments: comments.map((c) => toComment(c, display)),
    coverage: coverageOf(comments.length, comments.length, true),
    capabilities: { reply: UNKNOWN_PERMISSION, resolve: UNKNOWN_PERMISSION },
  };
}

// ── History ───────────────────────────────────────────────────────

const EVENT_KINDS: Record<string, ConversationEventKind> = {
  VoteUpdate: 'vote',
  RefUpdate: 'push',
  StatusUpdate: 'status-changed',
};

/** Which property names the person behind each kind of entry. */
const ACTOR_PROPERTY: Record<string, string> = {
  VoteUpdate: 'CodeReviewVotedByIdentity',
  RefUpdate: 'CodeReviewRefUpdatedByIdentity',
  StatusUpdate: 'CodeReviewStatusUpdatedByIdentity',
};

function property(raw: RawAdoThread, name: string): string | undefined {
  const value = raw.properties?.[name]?.$value;
  return value == null ? undefined : String(value);
}

function integer(value: string | undefined): number | undefined {
  const n = value == null ? NaN : Number(value);
  return Number.isInteger(n) ? n : undefined;
}

function eventActor(
  raw: RawAdoThread,
  type: string,
  first: RawComment | undefined
): ConversationActor | null {
  const key = property(raw, ACTOR_PROPERTY[type] ?? '');
  const named = key != null ? raw.identities?.[key] : undefined;
  return toActor(named ?? first?.author);
}

function toEvent(raw: RawAdoThread, display: DisplayText): ConversationEvent {
  const type = property(raw, 'CodeReviewThreadType') ?? 'unknown';
  const first = raw.comments?.[0];
  const vote = integer(property(raw, 'CodeReviewVoteResult'));
  return {
    id: String(raw.id ?? ''),
    kind: EVENT_KINDS[type] ?? 'system',
    actor: eventActor(raw, type, first),
    at: first?.publishedDate ?? raw.publishedDate ?? null,
    native: type,
    text: first?.content != null ? display(first.content) : null,
    ...(vote != null ? { vote } : {}),
  };
}

// ── Conversation ──────────────────────────────────────────────────

/** Every `@<GUID>` a display pass will want a name for. */
export function commentSources(threads: readonly RawAdoThread[]): string[] {
  return threads.flatMap((t) => (t.comments ?? []).map((c) => c.content ?? ''));
}

export function toAdoConversation(
  ref: PullRequestRef,
  raw: readonly RawAdoThread[],
  display: DisplayText = sanitizeBody
): PullRequestConversation {
  const threads: ConversationThread[] = [];
  const events: ConversationEvent[] = [];
  for (const t of raw) {
    if (t.isDeleted) continue;
    // A deleted comment keeps no text; its replies stay, answering it.
    const comments = (t.comments ?? []).filter((c) => !c.isDeleted);
    if (comments.some((c) => c.commentType !== 'system')) {
      threads.push(toThread(t, comments, display));
    } else if (comments.length > 0) {
      events.push(toEvent(t, display));
    }
  }
  const replies = threads.reduce((n, t) => n + t.comments.length, 0);
  return {
    ref,
    threads,
    comments: [],
    // Azure has no review summaries: a vote is an event.
    reviews: [],
    events,
    coverage: {
      threads: coverageOf(threads.length, threads.length, true),
      replies: coverageOf(replies, replies, true),
      comments: coverageOf(0, 0, true),
      reviews: coverageOf(0, 0, true),
      events: coverageOf(events.length, events.length, true),
    },
  };
}
