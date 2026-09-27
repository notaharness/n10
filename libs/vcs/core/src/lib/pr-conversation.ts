import type { Capability, Oid, PullRequestRef } from './pr-details.js';

/**
 * Everything said and done on a pull request, as its provider records
 * it: review threads, conversation comments, submitted reviews and the
 * events between them.
 *
 * The comment types in `types.ts` flatten this for the diff: one side,
 * one line pair, a resolved flag. That is enough to place a thread but
 * not to say where it was written, who resolved it, what Azure status
 * it is in, or whether every reply was read. This keeps those facts,
 * and it says how much of each collection was read, so no reader can
 * mistake a truncated list for a short one.
 */

/** Someone who wrote or did something, as the provider names them. */
export interface ConversationActor {
  /** What `VcsProvider.matchesUser` compares: the GitHub login, the
   *  Azure DevOps unique name. */
  identifier: string;
  displayName: string;
  /** The provider's stable id for the identity where it names one —
   *  Azure's GUID, which is what an Azure mention encodes. */
  id: string | null;
  /** `system` is the provider itself: Azure's own history entries. */
  kind: 'user' | 'bot' | 'system';
}

/**
 * How much of a collection was read. `total` is the provider's own
 * count where it reports one. A collection is complete only when
 * paging ran out and nothing the provider counted is missing.
 */
export interface Coverage {
  loaded: number;
  total: number | null;
  complete: boolean;
}

export interface ConversationComment {
  id: string;
  /** Null when the provider names nobody: a deleted account. */
  author: ConversationActor | null;
  /**
   * The markdown exactly as the provider stores it — what an edit
   * starts from. Azure mentions stay as `@<GUID>` here.
   */
  source: string;
  /** The source made fit to display: escape sequences stripped and
   *  Azure mentions resolved to names. Never written back. */
  body: string;
  /** `system` is an entry the provider wrote into a thread itself. */
  kind: 'text' | 'system';
  createdAt: string;
  /** When the text last changed, where the provider says. */
  editedAt: string | null;
  /**
   * Hidden by a moderator or its author. The text is still delivered;
   * showing it is the reader's choice, so it is labelled, not dropped.
   */
  minimized: { reason: string | null } | null;
  /** The comment this one answers, where the provider threads by it. */
  replyTo: string | null;
  /** The submitted review this comment was part of (GitHub). */
  reviewId: string | null;
  url: string | null;
  capabilities: { edit: Capability; delete: Capability };
}

/** A same-side line range in a file. Lines are 1-based and inclusive. */
export interface LineRange {
  side: 'LEFT' | 'RIGHT';
  start: number;
  end: number;
}

/**
 * Where a file thread points. The provider tracks a thread across
 * pushes: `current` is where it maps to now, `original` where it was
 * written. When the provider can no longer map it, `current` is null,
 * and the original range is only meaningful at `originalCommit` — the
 * same line number at the head may be different code.
 */
export interface ThreadAnchor {
  path: string;
  current: LineRange | null;
  original: LineRange | null;
  /** The commit the original range was written against (GitHub). */
  originalCommit: Oid | null;
  /** The iteration pair the thread was written against (Azure). */
  iterations: { first: number; second: number } | null;
}

export interface ThreadStatus {
  resolved: boolean;
  /**
   * The provider's own status: GitHub `resolved` / `unresolved`; Azure
   * `active`, `pending`, `fixed`, `wontFix`, `byDesign`, `closed`.
   * Azure's resolved statuses mean different things, so a reader
   * shows this word, not only the flag.
   */
  native: string;
  /** Who resolved it. Null when unresolved or the provider does not
   *  say — a reader shows "not provided", never a guess. */
  resolvedBy: ConversationActor | null;
}

export interface ConversationThread {
  id: string;
  /** `general` is about the pull request as a whole (an Azure thread
   *  with no file); `file` a whole file; `line` a range in it. */
  scope: 'general' | 'file' | 'line';
  anchor: ThreadAnchor | null;
  isOutdated: boolean;
  status: ThreadStatus;
  /** First entry is the root comment. */
  comments: ConversationComment[];
  coverage: Coverage;
  capabilities: { reply: Capability; resolve: Capability };
}

export type ReviewState =
  | 'approved'
  | 'changes-requested'
  | 'commented'
  | 'dismissed'
  /** The viewer's own review, started and not yet submitted. Private
   *  to them until they submit it. */
  | 'pending';

/** A submitted review: its verdict and summary, with or without
 *  inline comments. */
export interface ReviewSummary {
  id: string;
  author: ConversationActor | null;
  state: ReviewState;
  /** The provider's own word for the state. */
  native: string;
  source: string;
  body: string;
  submittedAt: string | null;
  /** The head the review was submitted against. */
  commit: Oid | null;
  /** Inline comments submitted with it. */
  commentCount: number;
  url: string | null;
}

export type ConversationEventKind =
  | 'commit'
  | 'push'
  | 'force-push'
  | 'base-changed'
  | 'review-requested'
  | 'review-request-removed'
  | 'review-dismissed'
  | 'vote'
  | 'ready-for-review'
  | 'converted-to-draft'
  | 'closed'
  | 'reopened'
  | 'merged'
  | 'status-changed'
  /** A provider history entry with no more specific reading. */
  | 'system';

/**
 * Something that happened on the pull request that is not a comment.
 * Azure writes its history as system comments; those arrive here, not
 * among the comments, so automation is never read as a person.
 */
export interface ConversationEvent {
  id: string;
  kind: ConversationEventKind;
  actor: ConversationActor | null;
  at: string | null;
  /** The provider's own type: a GraphQL typename, an Azure thread type. */
  native: string;
  /** The provider's description, where it writes one (Azure). */
  text: string | null;
  /** The commit a `commit` or `merged` event names. */
  commit?: Oid;
  /** A push's commits before and after, where the provider says. */
  before?: Oid | null;
  after?: Oid | null;
  /** Who a review request or vote was about: a person or a team. */
  subject?: string;
  /** Azure's iteration number for a push. */
  iteration?: number;
  /** Azure's vote value: 10, 5, 0, -5, -10. */
  vote?: number;
}

export interface PullRequestConversation {
  ref: PullRequestRef;
  threads: ConversationThread[];
  /**
   * Conversation comments that stand alone. A GitHub conversation
   * comment is not a thread: answering one adds another comment beside
   * it, so it is kept apart from the threads to stop anything showing
   * it as a nested reply. Azure's general comments are real threads
   * and are in `threads`.
   */
  comments: ConversationComment[];
  reviews: ReviewSummary[];
  events: ConversationEvent[];
  coverage: {
    threads: Coverage;
    /** Every thread's replies, together. */
    replies: Coverage;
    comments: Coverage;
    reviews: Coverage;
    events: Coverage;
  };
}

/** Whether every collection, and every thread's replies, was read in
 *  full. Anything less is not a basis for "nothing left to answer". */
export function isConversationComplete(c: PullRequestConversation): boolean {
  return Object.values(c.coverage).every((part) => part.complete);
}

/** Coverage of a list read to its end, against the provider's count. */
export function coverageOf(
  loaded: number,
  total: number | null,
  exhausted: boolean
): Coverage {
  return {
    loaded,
    total,
    complete: exhausted && (total == null || loaded >= total),
  };
}

/** The coverage of several collections read as one. */
export function combineCoverage(parts: readonly Coverage[]): Coverage {
  let loaded = 0;
  let total: number | null = 0;
  for (const part of parts) {
    loaded += part.loaded;
    total = total == null || part.total == null ? null : total + part.total;
  }
  return { loaded, total, complete: parts.every((p) => p.complete) };
}
