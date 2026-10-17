import {
  coverageOf,
  sanitizeBody,
  type Capability,
  type ConversationActor,
  type ConversationComment,
  type ConversationEvent,
  type ConversationEventDetail,
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
  /** A group: Azure's own service accounts write its history. */
  isContainer?: boolean;
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
      origFilePath?: string;
      origLeftFileStart?: RawLine;
      origLeftFileEnd?: RawLine;
      origRightFileStart?: RawLine;
      origRightFileEnd?: RawLine;
    };
  } | null;
  comments?: RawComment[];
  /** Values arrive wrapped with their .NET type: `{ $type, $value }`. */
  properties?: Record<string, { $value?: unknown } | undefined> | null;
}

/** Turns a raw comment body into display text: escape sequences out,
 *  `@<GUID>` mentions resolved to names where they can be. */
export type DisplayText = (source: string) => string;

const UNKNOWN_PERMISSION: Capability = {
  state: 'unknown',
  reason: 'Azure DevOps does not say what you may do with a thread',
};

/** Azure's own accounts: the service group that writes system
 *  comments, and the service identity some organizations show. */
function isService(raw: RawIdentity): boolean {
  return (
    raw.isContainer === true ||
    raw.displayName === 'Microsoft.VisualStudio.Services.TFS'
  );
}

/** A person as Azure names them. The unique name is what
 *  `matchesUser` compares; an identity with only an id keeps the id,
 *  which matches nobody. */
function toActor(raw: RawIdentity | undefined): ConversationActor | null {
  const identifier = raw?.uniqueName ?? raw?.id;
  if (!raw || !identifier) return null;
  return {
    identifier,
    displayName: raw.displayName ?? identifier,
    id: raw.id ?? null,
    kind: isService(raw) ? 'system' : 'user',
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
    deleted: raw.isDeleted === true,
    createdAt: published,
    editedAt: edited && edited !== published ? edited : null,
    minimized: null,
    // Azure has no private review drafts: a comment is posted or absent.
    pending: false,
    replyTo: raw.parentCommentId ? String(raw.parentCommentId) : null,
    reviewId: null,
    url: null,
    capabilities: { edit: UNKNOWN_PERMISSION, delete: UNKNOWN_PERMISSION },
  };
}

/** A range from Azure's four line refs, on one side. Right wins: a
 *  thread with only left-side refs is on a deleted or old line. */
function rangeOf(
  leftStart: RawLine | undefined,
  leftEnd: RawLine | undefined,
  rightStart: RawLine | undefined,
  rightEnd: RawLine | undefined
): LineRange | null {
  const [side, start, end] =
    rightStart?.line != null
      ? (['RIGHT', rightStart, rightEnd] as const)
      : (['LEFT', leftStart, leftEnd] as const);
  if (start?.line == null) return null;
  return {
    startSide: side,
    start: start.line,
    side,
    end: end?.line ?? start.line,
  };
}

/** Azure's resolved statuses. `pending` is open: the author has not
 *  decided. */
const RESOLVED = new Set(['fixed', 'wontFix', 'closed', 'byDesign']);

type PrContext = NonNullable<RawAdoThread['pullRequestThreadContext']>;

function iterationsOf(
  ctx: PrContext['iterationContext']
): { first: number; second: number } | null {
  const first = ctx?.firstComparingIteration;
  const second = ctx?.secondComparingIteration;
  return first != null && second != null ? { first, second } : null;
}

/** Azure's paths carry a leading slash; the diff's do not. */
const repoPath = (path: string) => path.replace(/^\//, '');

function anchorOf(raw: RawAdoThread): ConversationThread['anchor'] {
  const ctx = raw.threadContext;
  if (!ctx?.filePath) return null;
  const orig = raw.pullRequestThreadContext?.trackingCriteria ?? {};
  const path = repoPath(ctx.filePath);
  const originalPath = orig.origFilePath && repoPath(orig.origFilePath);
  return {
    path,
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
    originalPath: originalPath && originalPath !== path ? originalPath : null,
    originalCommit: null,
    iterations: iterationsOf(raw.pullRequestThreadContext?.iterationContext),
    diffHunk: null,
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

/**
 * The property prefix naming who did each kind of entry. The comment
 * on a history entry is written by Azure's service account, so the
 * person is only ever in these; an entry that names nobody has no
 * actor rather than the service's.
 */
const ACTOR_PREFIX: Record<string, string> = {
  VoteUpdate: 'CodeReviewVotedBy',
  RefUpdate: 'CodeReviewRefUpdatedBy',
  ReviewersUpdate: 'CodeReviewReviewersUpdatedBy',
  StatusUpdate: 'CodeReviewStatusUpdatedBy',
};

/** A property's value. Azure is not consistent about case —
 *  `…UpdatedByDisplayname` sits beside `…VotedByDisplayName` — so the
 *  name is matched without it. */
function property(raw: RawAdoThread, name: string): string | undefined {
  const props = raw.properties ?? {};
  const key = Object.keys(props).find(
    (k) => k.toLowerCase() === name.toLowerCase()
  );
  const value = key ? props[key]?.$value : undefined;
  return value == null ? undefined : String(value);
}

function integer(value: string | undefined): number | undefined {
  const n = value == null ? NaN : Number(value);
  return Number.isInteger(n) ? n : undefined;
}

function eventActor(raw: RawAdoThread, type: string): ConversationActor | null {
  const prefix = ACTOR_PREFIX[type];
  if (!prefix) return null;
  // `…RefUpdatedBy` itself holds the unique name, where Azure gives it.
  const unique = property(raw, prefix);
  return toActor({
    id: property(raw, `${prefix}TfId`),
    displayName: property(raw, `${prefix}DisplayName`),
    uniqueName: unique?.includes('@') ? unique : undefined,
  });
}

/** The events Azure's history entries can be. */
type HistoryDetail = ConversationEventDetail<
  Extract<
    ConversationEvent,
    { kind: 'vote' | 'push' | 'status-changed' | 'system' }
  >
>;

/** The event reading of each kind of history entry Azure writes. */
function detailOf(
  raw: RawAdoThread,
  type: string,
  text: string | null
): HistoryDetail {
  switch (type) {
    case 'VoteUpdate': {
      const vote = integer(property(raw, 'CodeReviewVoteResult')) ?? null;
      return { kind: 'vote', vote, text };
    }
    case 'RefUpdate':
      return { kind: 'push', text };
    case 'StatusUpdate':
      return { kind: 'status-changed', text };
    default:
      return { kind: 'system', text };
  }
}

function toEvent(raw: RawAdoThread, display: DisplayText): ConversationEvent {
  const type = property(raw, 'CodeReviewThreadType') ?? 'unknown';
  const first = raw.comments?.[0];
  const text = first?.content != null ? display(first.content) : null;
  return {
    id: String(raw.id ?? ''),
    actor: eventActor(raw, type),
    at: first?.publishedDate ?? raw.publishedDate ?? null,
    native: type,
    ...detailOf(raw, type, text),
  };
}

// ── Conversation ──────────────────────────────────────────────────

/** A thread's comments without the deleted ones nothing hangs off. A
 *  deleted root, or one somebody replied to, stays as a tombstone. */
function keptComments(all: RawComment[]): RawComment[] {
  const answered = new Set(all.map((c) => c.parentCommentId));
  return all.filter((c, i) => !c.isDeleted || i === 0 || answered.has(c.id));
}

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
    const comments = keptComments(t.comments ?? []);
    if (comments.some((c) => c.commentType !== 'system')) {
      threads.push(toThread(t, comments, display));
    } else if (comments.length > 0) {
      events.push(toEvent(t, display));
    }
  }
  const inThreads = threads.reduce((n, t) => n + t.comments.length, 0);
  return {
    ref,
    threads,
    comments: [],
    // Azure has no review summaries: a vote is an event.
    reviews: [],
    events,
    coverage: {
      threads: coverageOf(threads.length, threads.length, true),
      threadComments: coverageOf(inThreads, inThreads, true),
      comments: coverageOf(0, 0, true),
      reviews: coverageOf(0, 0, true),
      events: coverageOf(events.length, events.length, true),
    },
  };
}
