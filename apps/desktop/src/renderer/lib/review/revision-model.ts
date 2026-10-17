import type {
  PullRequestHistory,
  RevisionEvent,
} from '../../../host/contract.js';
import { relativeTime } from '../utils.js';

/**
 * Which changes of a pull request the diff shows: all of them, those
 * since the reader's last visit or last submitted review, or those
 * between any two of its revisions (spec D4).
 *
 * "Since" compares the revision the reader saw with the head on screen,
 * tree to tree. Nothing stands in for a revision that is missing: an
 * option without one says why, and a range whose revision cannot be
 * read says so (`pr-revision-range.ts` in core).
 */

export type RevisionChoice =
  | { mode: 'all' }
  | { mode: 'since-visit' }
  | { mode: 'since-review' }
  | { mode: 'range'; from: string; to: string };

export type SinceMode = 'since-visit' | 'since-review';

/** The pull request's history as the diff has it so far. */
export type HistoryRead =
  | { state: 'loading' }
  | { state: 'failed'; reason: string }
  | { state: 'read'; value: PullRequestHistory };

export interface SinceOption {
  mode: SinceMode;
  label: string;
  /** The revision it compares from; null when there is none to use. */
  from: string | null;
  /** Under the label: when that revision was, or why there is none. */
  detail: string;
  /** Still being read: neither available nor explained yet. */
  pending: boolean;
}

export const short = (oid: string) => oid.slice(0, 7);

const LABELS: Record<SinceMode, string> = {
  'since-visit': 'Since your last visit',
  'since-review': 'Since your last review',
};

function seen(head: string, at: string | number | null): string {
  return at === null ? short(head) : `${short(head)} · ${relativeTime(at)}`;
}

function option(
  mode: SinceMode,
  from: string | null,
  detail: string,
  pending = false
): SinceOption {
  return { mode, label: LABELS[mode], from, detail, pending };
}

function sinceVisit(history: PullRequestHistory): SinceOption {
  const visit = history.lastVisit;
  if (visit.state !== 'read') {
    return option('since-visit', null, `Couldn’t read it: ${visit.reason}`);
  }
  if (visit.value === null) {
    return option('since-visit', null, 'This is your first visit');
  }
  return option(
    'since-visit',
    visit.value.head,
    seen(visit.value.head, visit.value.at)
  );
}

function sinceReview(history: PullRequestHistory): SinceOption {
  const review = history.lastReview;
  if (review.state === 'unsupported') {
    return option('since-review', null, review.reason);
  }
  if (review.state === 'failed') {
    return option('since-review', null, `Couldn’t read it: ${review.reason}`);
  }
  if (review.value === null) {
    return option('since-review', null, 'You haven’t submitted a review');
  }
  return option(
    'since-review',
    review.value.head,
    seen(review.value.head, review.value.at)
  );
}

/** The two "since" options, each with its revision or why it has none. */
export function sinceOptions(history: HistoryRead): SinceOption[] {
  if (history.state === 'loading') {
    return (['since-visit', 'since-review'] as const).map((mode) =>
      option(mode, null, 'Reading the history…', true)
    );
  }
  if (history.state === 'failed') {
    const why = `Couldn’t read the history: ${history.reason}`;
    return [
      option('since-visit', null, why),
      option('since-review', null, why),
    ];
  }
  return [sinceVisit(history.value), sinceReview(history.value)];
}

/**
 * Whether some of the history could not be read — all of it, or the
 * provider's revisions, the last visit or the last review, each of
 * which fails on its own — so reading it again may help.
 */
export function historyFailed(history: HistoryRead): boolean {
  if (history.state !== 'read') return history.state === 'failed';
  const { revisions, lastVisit, lastReview } = history.value;
  return [revisions, lastVisit, lastReview].some((p) => p.state === 'failed');
}

/** Two revisions to diff, `from` the old side. */
export interface RevisionPair {
  from: string;
  to: string;
}

/** What the diff reads for a choice. */
export type PairRead =
  /** All changes. */
  | null
  | RevisionPair
  /** The history that names the revision is still being read. */
  | 'pending'
  /** A "since" with no revision to start from, and why. */
  | { unavailable: string };

/**
 * What the diff reads for `choice`, with `head` the head on screen. A
 * "since" without its revision reads nothing and says why — never all
 * changes in its place, which would pass for "nothing older to see".
 */
export function pairOf(
  choice: RevisionChoice,
  options: readonly SinceOption[],
  head: string
): PairRead {
  if (choice.mode === 'all') return null;
  if (choice.mode === 'range') return { from: choice.from, to: choice.to };
  const since = options.find((o) => o.mode === choice.mode);
  if (!since || since.pending) return 'pending';
  return since.from
    ? { from: since.from, to: head }
    : { unavailable: since.detail };
}

/**
 * The pull request's file count, for counting a range's files out of —
 * only when every file the range lists is one of them. A range that
 * takes in the target's changes, or runs across a rewrite, can list
 * files the pull request does not change, and "2 of 2 files" would
 * then read as all of its files.
 */
interface Listing {
  complete: boolean;
  files: readonly { path: string }[];
}

export function totalOf(
  all: Listing | undefined,
  range: Pick<Listing, 'files'> | undefined
): number | null {
  if (!all?.complete || !range) return null;
  const paths = new Set(all.files.map((f) => f.path));
  return range.files.every((f) => paths.has(f.path)) ? all.files.length : null;
}

export type AnchoredSides = Readonly<Record<'LEFT' | 'RIGHT', boolean>>;

// One object each, so what is built from them keeps its identity.
const BOTH: AnchoredSides = { LEFT: true, RIGHT: true };
const BASE: AnchoredSides = { LEFT: true, RIGHT: false };
const HEAD: AnchoredSides = { LEFT: false, RIGHT: true };
const NEITHER: AnchoredSides = { LEFT: false, RIGHT: false };

/**
 * Which sides of the diff on screen number their lines as comments do:
 * the old side when it is the pull request's merge base, the new side
 * when it is its head. A "since" ends at the head, so its new side
 * holds; a range between two earlier revisions holds neither.
 */
export function anchoredSides(
  pair: RevisionPair | null,
  comparison: { mergeBaseOid: string; headOid: string } | null
): AnchoredSides {
  if (!pair || !comparison) return BOTH;
  const right = pair.to === comparison.headOid;
  if (pair.from === comparison.mergeBaseOid) return right ? BOTH : BASE;
  return right ? HEAD : NEITHER;
}

/** One revision a range can start or end at. */
export interface RevisionEntry {
  oid: string;
  /** What it was: a push, a force-push or what one replaced, your
   *  last visit… */
  labels: string[];
  at: string | number | null;
}

function eventLabel(event: RevisionEvent): string {
  if (event.kind === 'force-push') return 'Force-pushed';
  if (event.kind === 'iteration') return `Update ${event.id}`;
  return 'Commit';
}

const timeOf = (at: string | number | null) =>
  typeof at === 'number' ? at : at === null ? NaN : Date.parse(at);

type Named = [oid: string, label: string, at: string | number | null];

/** What the provider's events and the reader's checkpoints name. */
function namedIn(history: PullRequestHistory): Named[] {
  const named: Named[] = [];
  if (history.revisions.state === 'read') {
    for (const e of history.revisions.value.events) {
      named.push([e.head, eventLabel(e), e.at]);
      // What it replaced was the head until then, and may be listed
      // nowhere else.
      if (e.kind === 'force-push' && e.before) {
        named.push([e.before, 'Replaced', e.at]);
      }
    }
  }
  const { lastVisit: visit, lastReview: review } = history;
  if (visit.state === 'read' && visit.value) {
    named.push([visit.value.head, 'Your last visit', visit.value.at]);
  }
  if (review.state === 'read' && review.value?.head) {
    named.push([review.value.head, 'Your last review', review.value.at]);
  }
  return named;
}

/**
 * Every revision the history names, each once, newest first — one with
 * no time (the head on screen, when the provider does not list it) at
 * the top: the provider's events, the reader's last visit and review,
 * and the head on screen.
 */
export function revisionEntries(
  history: PullRequestHistory | null,
  head: string
): RevisionEntry[] {
  const byOid = new Map<string, RevisionEntry>();
  const named = history ? namedIn(history) : [];
  for (const [oid, label, at] of [
    ...named,
    [head, 'On screen', null] as Named,
  ]) {
    const entry = byOid.get(oid) ?? { oid, labels: [], at };
    if (!entry.labels.includes(label)) entry.labels.push(label);
    entry.at ??= at;
    byOid.set(oid, entry);
  }
  const rank = (e: RevisionEntry) => {
    const t = timeOf(e.at);
    return Number.isNaN(t) ? Infinity : t;
  };
  return [...byOid.values()].sort((a, b) => Math.sign(rank(b) - rank(a)) || 0);
}
