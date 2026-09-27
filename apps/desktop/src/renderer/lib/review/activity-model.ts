import type {
  ConversationActor,
  ConversationComment,
  ConversationEvent,
  ConversationThread,
  PullRequestConversation,
  ReviewSummary,
} from '../../../host/contract.js';

/**
 * A pull request's conversation as one chronological activity list.
 *
 * Order is the provider's time for each record, oldest first, so a
 * reply is read after what it answers. Automation — bot comments and
 * provider history with no specific reading — collapses into one
 * disclosure between the human entries, and a run of commits into one
 * push. Filters and search select entries; they never reorder them.
 */

export type ActivityEntry =
  | { kind: 'review'; id: string; at: string | null; review: ReviewSummary }
  | {
      kind: 'comment';
      id: string;
      at: string | null;
      comment: ConversationComment;
    }
  | {
      kind: 'thread';
      id: string;
      at: string | null;
      thread: ConversationThread;
    }
  | { kind: 'event'; id: string; at: string | null; event: ConversationEvent };

export type CommitEvent = Extract<ConversationEvent, { kind: 'commit' }>;

export type ActivityRow =
  | ActivityEntry
  | { kind: 'commits'; id: string; at: string | null; events: CommitEvent[] }
  | {
      kind: 'automation';
      id: string;
      at: string | null;
      entries: ActivityEntry[];
    };

export type ActivityFilter =
  | 'all'
  | 'open'
  | 'resolved'
  | 'outdated'
  | 'mine'
  | 'mentions';

function time(at: string | null): number {
  const t = at == null ? NaN : Date.parse(at);
  // Undated records (an unsubmitted review) read after everything dated.
  return Number.isNaN(t) ? Infinity : t;
}

/** Every record of the conversation, oldest first. */
export function buildActivity(c: PullRequestConversation): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    ...c.reviews.map((review) => ({
      kind: 'review' as const,
      id: review.id,
      at: review.submittedAt,
      review,
    })),
    ...c.comments.map((comment) => ({
      kind: 'comment' as const,
      id: comment.id,
      at: comment.createdAt,
      comment,
    })),
    ...c.threads.map((thread) => ({
      kind: 'thread' as const,
      id: thread.id,
      at: thread.comments[0]?.createdAt ?? null,
      thread,
    })),
    ...c.events.map((event) => ({
      kind: 'event' as const,
      id: event.id,
      at: event.at,
      event,
    })),
  ];
  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => time(a.entry.at) - time(b.entry.at) || a.i - b.i)
    .map(({ entry }) => entry);
}

function actorOf(entry: ActivityEntry): ConversationActor | null {
  switch (entry.kind) {
    case 'review':
      return entry.review.author;
    case 'comment':
      return entry.comment.author;
    case 'thread':
      return entry.thread.comments[0]?.author ?? null;
    case 'event':
      return entry.event.actor;
  }
}

/** Written by a bot or by the provider itself, or history the reader
 *  has no specific reading for. */
export function isAutomation(entry: ActivityEntry): boolean {
  if (entry.kind === 'event' && entry.event.kind === 'system') return true;
  const kind = actorOf(entry)?.kind;
  return kind === 'bot' || kind === 'system';
}

/** Commits in a row read as one push; bot and provider noise in a row
 *  reads as one disclosure. */
export function groupActivity(
  entries: readonly ActivityEntry[]
): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const entry of entries) {
    const last = rows.at(-1);
    if (entry.kind === 'event' && entry.event.kind === 'commit') {
      if (last?.kind === 'commits') last.events.push(entry.event);
      else rows.push(commitsRow(entry.event));
    } else if (isAutomation(entry)) {
      if (last?.kind === 'automation') last.entries.push(entry);
      else
        rows.push({
          kind: 'automation',
          id: `auto:${entry.id}`,
          at: entry.at,
          entries: [entry],
        });
    } else {
      rows.push(entry);
    }
  }
  return rows.map(unwrapSingle);
}

function commitsRow(event: CommitEvent): ActivityRow {
  return {
    kind: 'commits',
    id: `commits:${event.id}`,
    at: event.at,
    events: [event],
  };
}

/** A lone commit is an event row; a lone automated entry is still
 *  folded, so noise never takes a full row. */
function unwrapSingle(row: ActivityRow): ActivityRow {
  if (row.kind !== 'commits' || row.events.length > 1) return row;
  const event = row.events[0]!;
  return { kind: 'event', id: event.id, at: event.at, event };
}

// ── Filters and search ────────────────────────────────────────────

function sameAccount(a: ConversationActor | null, viewer: string): boolean {
  return a != null && a.identifier.toLowerCase() === viewer.toLowerCase();
}

function textsOf(entry: ActivityEntry): ConversationComment[] {
  if (entry.kind === 'comment') return [entry.comment];
  if (entry.kind === 'thread') return entry.thread.comments;
  return [];
}

/** Markdown with its code taken out: GitHub does not mention anyone
 *  from inside a code block or span. */
function prose(source: string): string {
  return source.replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]*`/g, '');
}

/** Whether the markdown mentions `@login`, as GitHub reads one. */
function mentions(source: string, viewer: string): boolean {
  const escaped = viewer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w@])@${escaped}(?![\\w-])`, 'i').test(
    prose(source)
  );
}

function isMine(entry: ActivityEntry, viewer: string): boolean {
  if (entry.kind === 'review') return sameAccount(entry.review.author, viewer);
  return textsOf(entry).some((c) => sameAccount(c.author, viewer));
}

function mentionsViewer(entry: ActivityEntry, viewer: string): boolean {
  const sources =
    entry.kind === 'review'
      ? [entry.review.source]
      : textsOf(entry).map((c) => c.source);
  return sources.some((s) => mentions(s, viewer));
}

const THREAD_FILTERS: Partial<
  Record<ActivityFilter, (t: ConversationThread) => boolean>
> = {
  open: (t) => !t.status.resolved,
  resolved: (t) => t.status.resolved,
  outdated: (t) => t.isOutdated,
};

export function matchesFilter(
  entry: ActivityEntry,
  filter: ActivityFilter,
  viewer: string | null
): boolean {
  if (filter === 'all') return true;
  const byThread = THREAD_FILTERS[filter];
  if (byThread) return entry.kind === 'thread' && byThread(entry.thread);
  if (!viewer) return false;
  return filter === 'mine'
    ? isMine(entry, viewer)
    : mentionsViewer(entry, viewer);
}

/** The comments of an entry that contain `query`, for a thread to open
 *  on and a reader to find. Empty for no match or no query. */
export function matchingComments(
  entry: ActivityEntry,
  query: string
): Set<string> {
  const q = query.trim().toLowerCase();
  if (!q) return new Set();
  return new Set(
    textsOf(entry)
      .filter((c) =>
        `${c.author?.displayName ?? ''}\n${c.body}`.toLowerCase().includes(q)
      )
      .map((c) => c.id)
  );
}

function eventText(event: ConversationEvent): string {
  switch (event.kind) {
    case 'commit':
      return `${event.headline ?? ''} ${event.commit}`;
    case 'vote':
    case 'push':
    case 'status-changed':
    case 'system':
      return event.text ?? '';
    default:
      return '';
  }
}

export function matchesQuery(entry: ActivityEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const own = [actorOf(entry)?.displayName ?? ''];
  if (entry.kind === 'review') own.push(entry.review.body);
  if (entry.kind === 'thread') own.push(entry.thread.anchor?.path ?? '');
  if (entry.kind === 'event') own.push(eventText(entry.event));
  return (
    own.some((text) => text.toLowerCase().includes(q)) ||
    matchingComments(entry, q).size > 0
  );
}

export function selectActivity(
  entries: readonly ActivityEntry[],
  filter: ActivityFilter,
  query: string,
  viewer: string | null
): ActivityEntry[] {
  return entries.filter(
    (e) => matchesFilter(e, filter, viewer) && matchesQuery(e, query)
  );
}

export function filterCounts(
  entries: readonly ActivityEntry[],
  viewer: string | null
): Record<ActivityFilter, number> {
  const count = (f: ActivityFilter) =>
    entries.filter((e) => matchesFilter(e, f, viewer)).length;
  return {
    all: entries.length,
    open: count('open'),
    resolved: count('resolved'),
    outdated: count('outdated'),
    mine: count('mine'),
    mentions: count('mentions'),
  };
}

// ── New updates ───────────────────────────────────────────────────

/**
 * What the reader has been shown, and what arrived since. Entries that
 * appear on a refresh are held back behind "N new updates" instead of
 * sliding into the list under the reader; replies inside a thread they
 * already see are part of that thread and show at once.
 */
export function splitNew(
  entries: readonly ActivityEntry[],
  seen: ReadonlySet<string> | null
): { shown: ActivityEntry[]; held: ActivityEntry[] } {
  if (!seen) return { shown: [...entries], held: [] };
  const shown: ActivityEntry[] = [];
  const held: ActivityEntry[] = [];
  for (const e of entries) (seen.has(e.id) ? shown : held).push(e);
  return { shown, held };
}
