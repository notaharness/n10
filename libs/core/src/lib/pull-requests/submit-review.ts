import { randomUUID } from 'node:crypto';
import {
  isOid,
  isReviewPublishError,
  type LedgerStore,
  type Oid,
  type PublishedReview,
  type ReviewEvent,
  type ReviewItem,
  type ReviewSubmission,
} from '@n10/vcs-core';
import { assertSameContext } from './pr-snapshot.js';
import {
  defaultDraftDir,
  draftFilePath,
  readDraftFile,
  writeDraftFile,
  type DraftFile,
} from './review-draft-store.js';
import type { Publication, ReviewDraft } from './review-draft-types.js';
import {
  parseDraftsRequest,
  type DraftSources,
  type DraftsRequest,
  type ReviewDrafts,
} from './review-drafts.js';
import { withSubmitClaim } from './submit-claims.js';

/**
 * The reviewer's chosen drafts filed as one native review, by identity.
 *
 * The drafts file is the record: before anything is sent each chosen
 * draft is marked `publishing` under one attempt, and the provider's
 * ledger of the review is kept beside them as it goes. A review that
 * stops part-way — refused, unanswered, or n10 closed — is resumed from
 * there by the next submit, never started again.
 */

export interface SubmitReviewRequest extends DraftsRequest {
  /** The head commit the reviewer read. */
  head: Oid;
  event: ReviewEvent;
  /** The drafts to file. The summary, if chosen, is the review's text. */
  draftIds: string[];
}

export interface SubmittedReview extends ReviewDrafts {
  /** The review had already been filed — by an earlier submit whose
   *  answer was lost, or by the reviewer on the provider — and nothing
   *  of this request was sent: the provider's state for it. The drafts
   *  say which of them it holds. */
  resumed: { state: string } | null;
}

export type SubmitSources = DraftSources & {
  /** Absent when the provider cannot file a review. */
  publish?: (
    submission: ReviewSubmission,
    ledger: LedgerStore
  ) => Promise<PublishedReview>;
};

const EVENTS: readonly string[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'];

export function parseSubmitReviewRequest(value: unknown): SubmitReviewRequest {
  const base = parseDraftsRequest(value);
  const { head, event, draftIds } = value as Record<string, unknown>;
  if (!isOid(head)) throw new TypeError('Invalid head commit');
  if (typeof event !== 'string' || !EVENTS.includes(event)) {
    throw new TypeError('Invalid review event');
  }
  if (
    !Array.isArray(draftIds) ||
    draftIds.length > 500 ||
    !draftIds.every((id) => typeof id === 'string')
  ) {
    throw new TypeError('Invalid draft ids');
  }
  return {
    ...base,
    head,
    event: event as ReviewEvent,
    draftIds: [...new Set(draftIds as string[])],
  };
}

export async function submitReview(
  req: SubmitReviewRequest,
  src: SubmitSources
): Promise<SubmittedReview> {
  const viewer = assertSameContext(req, src);
  if (!src.publish) {
    throw new Error("This provider can't file a review from n10");
  }
  const dir = src.dir ?? defaultDraftDir();
  const publish = src.publish;
  return withSubmitClaim(draftFilePath(dir, req.ref, viewer), () =>
    submitClaimed(req, { ...src, publish }, dir, viewer)
  );
}

async function submitClaimed(
  req: SubmitReviewRequest,
  src: SubmitSources & { publish: NonNullable<SubmitSources['publish']> },
  dir: string,
  viewer: string | null
): Promise<SubmittedReview> {
  const now = src.now ?? Date.now;
  const drafts = new DraftsFile(dir, req.ref, viewer);
  const file = drafts.read();
  const chosen = choose(file, req.draftIds);
  const submission = toSubmission(req, chosen);
  const attempt = file.submission?.attempt ?? randomUUID();
  const before = file.submission?.draftIds ?? [];
  const held = heldBack(file, chosen);

  drafts.update((f) => ({
    ...f,
    drafts: f.drafts.map((d) =>
      publicationFor(d, chosen, { before, held }, attempt, now())
    ),
    submission: {
      attempt,
      draftIds: [...chosen.map((d) => d.id), ...held],
      ledger: f.submission?.ledger ?? null,
    },
  }));

  let resumed: SubmittedReview['resumed'] = null;
  const ledger: LedgerStore = {
    read: () => drafts.read().submission?.ledger ?? null,
    write: (l) =>
      drafts.update((f) => ({
        ...f,
        submission: { ...f.submission!, ledger: l },
      })),
  };

  try {
    const published = await src.publish(submission, ledger);
    drafts.update((f) => ({
      ...f,
      drafts: f.drafts.map((d) =>
        settled(d, published, summarySent(chosen, published), attempt, now())
      ),
      submission: undefined,
    }));
    resumed = published.resumed && { state: published.resumed.state };
  } catch (err) {
    const unanswered = ledger.read()?.inFlight != null;
    drafts.update((f) => ({
      ...f,
      drafts: f.drafts.map((d) => {
        if (!ownedBy(d, attempt)) return d;
        // Accounted for and not chosen: not on the provider.
        if (held.includes(d.id) && !unanswered) {
          return { ...d, publication: { state: 'unpublished' as const } };
        }
        return { ...d, publication: afterFailure(d, err, unanswered, now()) };
      }),
    }));
    throw err;
  }
  return { ref: req.ref, viewer, drafts: drafts.read().drafts, resumed };
}

/** The file for one account and pull request, read afresh each time. */
class DraftsFile {
  constructor(
    private readonly dir: string,
    private readonly ref: SubmitReviewRequest['ref'],
    private readonly viewer: string | null
  ) {}

  read(): DraftFile {
    return readDraftFile(this.dir, this.ref, this.viewer);
  }

  update(change: (file: DraftFile) => DraftFile): void {
    writeDraftFile(this.dir, change(this.read()));
  }
}

/**
 * The chosen drafts, in the order they were written. A conversation
 * comment is not part of a review; a draft already posted, or being
 * posted by another attempt, cannot be filed again.
 */
function choose(file: DraftFile, ids: string[]): ReviewDraft[] {
  const resuming = new Set(file.submission?.draftIds ?? []);
  const wanted = new Set(ids);
  const chosen = file.drafts.filter((d) => wanted.has(d.id));
  if (chosen.length !== wanted.size) {
    throw new Error('Some of the chosen drafts are no longer here');
  }
  for (const d of chosen) {
    if (d.target.kind === 'general') {
      throw new Error(
        'A comment on the conversation is posted on its own, not with a review'
      );
    }
    const { state } = d.publication;
    if (state === 'published')
      throw new Error('A chosen draft is already posted');
    if (
      (state === 'publishing' || state === 'unknown') &&
      !resuming.has(d.id)
    ) {
      throw new Error('A chosen draft is being posted by another review');
    }
  }
  return chosen;
}

function toSubmission(
  req: SubmitReviewRequest,
  chosen: ReviewDraft[]
): ReviewSubmission {
  const summary = chosen.find((d) => d.target.kind === 'summary');
  const items = chosen.flatMap((d): ReviewItem[] => {
    const t = d.target;
    if (t.kind === 'reply') {
      return [
        {
          key: d.id,
          body: d.body,
          place: { kind: 'reply', threadId: t.threadId },
        },
      ];
    }
    if (t.kind !== 'inline') return [];
    const { path, range } = t.anchor;
    return [
      {
        key: d.id,
        body: d.body,
        place: range ? { kind: 'line', path, range } : { kind: 'file', path },
      },
    ];
  });
  if (
    req.event === 'REQUEST_CHANGES' &&
    !summary?.body.trim() &&
    !items.length
  ) {
    throw new Error(
      'Say what needs to change: write a summary or choose a comment'
    );
  }
  if (req.event === 'COMMENT' && !summary?.body.trim() && !items.length) {
    throw new Error(
      'There is nothing to post: write a summary or choose a comment'
    );
  }
  return {
    prId: req.ref.number,
    head: req.head,
    event: req.event,
    body: summary?.body ?? '',
    items,
  };
}

/**
 * Drafts an earlier attempt chose and this one does not, while a step
 * of that attempt is still unaccounted for: any of them may be on the
 * provider already, so they stay locked in this attempt until it is
 * known.
 */
function heldBack(file: DraftFile, chosen: ReviewDraft[]): string[] {
  const s = file.submission;
  if (s?.ledger?.inFlight == null) return [];
  const ids = new Set(chosen.map((d) => d.id));
  return s.draftIds.filter((id) => !ids.has(id));
}

/** A chosen draft goes out under `attempt`; one held back waits under
 *  it, maybe posted; one an earlier attempt had chosen and this one
 *  did not is back to unpublished. */
function publicationFor(
  d: ReviewDraft,
  chosen: ReviewDraft[],
  earlier: { before: string[]; held: string[] },
  attempt: string,
  at: number
): ReviewDraft {
  if (chosen.some((c) => c.id === d.id)) {
    return { ...d, publication: { state: 'publishing', attempt, since: at } };
  }
  if (earlier.held.includes(d.id)) {
    return { ...d, publication: { state: 'unknown', attempt, since: at } };
  }
  if (earlier.before.includes(d.id)) {
    return { ...d, publication: { state: 'unpublished' } };
  }
  return d;
}

/** Marked by this attempt (being posted, or held back maybe posted),
 *  and not settled since. */
function ownedBy(d: ReviewDraft, attempt: string): boolean {
  const p = d.publication;
  return (
    (p.state === 'publishing' || p.state === 'unknown') && p.attempt === attempt
  );
}

/**
 * The summary text the filed review carries, as n10's: what this
 * submit sent, or — for a review already filed — the review's own text
 * when it is the summary draft's, whoever filed it.
 */
function summarySent(
  chosen: ReviewDraft[],
  published: PublishedReview
): (d: ReviewDraft) => boolean {
  if (!published.resumed) {
    const sent = chosen.some((d) => d.target.kind === 'summary');
    return () => sent;
  }
  const { body } = published.resumed;
  return (d) => body.trim() !== '' && d.body === body;
}

/**
 * Where a draft stands once the review is filed: posted when the
 * review holds it (an item by its comment, the summary as the review's
 * own text when it went with the submit), or back to unpublished when
 * this attempt chose it and the review filed does not hold it.
 */
function settled(
  d: ReviewDraft,
  published: PublishedReview,
  summary: (d: ReviewDraft) => boolean,
  attempt: string,
  at: number
): ReviewDraft {
  const remoteId =
    published.items[d.id] ??
    (d.target.kind === 'summary' && summary(d) ? published.reviewId : null);
  if (remoteId) {
    return { ...d, publication: { state: 'published', attempt, remoteId, at } };
  }
  return ownedBy(d, attempt)
    ? { ...d, publication: { state: 'unpublished' } }
    : d;
}

/**
 * Where a draft stands after a failed attempt. Unanswered: it may be in
 * the review, so it is looked for next time. Refused at an item: that
 * draft carries the provider's reason and can be edited; the others
 * were not refused and are as they were. Refused at the review itself:
 * every draft carries the reason. Stopped before any write (the pull
 * request moved on, a pending review of the reviewer's own): as it was.
 */
function afterFailure(
  d: ReviewDraft,
  err: unknown,
  unanswered: boolean,
  at: number
): Publication {
  const { attempt } = d.publication as { attempt: string };
  const reason = err instanceof Error ? err.message : String(err);
  // A step of this or an earlier attempt is still unaccounted for.
  if (unanswered) return { state: 'unknown', attempt, since: at };
  if (!isReviewPublishError(err)) {
    // The read before any write failed: nothing was sent.
    return { state: 'failed', attempt, reason, at };
  }
  if (err.failure !== 'refused') return { state: 'unpublished' };
  if (err.item && err.item !== d.id) return { state: 'unpublished' };
  return { state: 'failed', attempt, reason, at };
}
