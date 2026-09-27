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

export type SubmitSources = DraftSources & {
  /** Absent when the provider cannot file a review. */
  publish?: (
    submission: ReviewSubmission,
    ledger: LedgerStore
  ) => Promise<PublishedReview>;
};

const EVENTS: readonly string[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'];

/**
 * Drafts files with a submit running in this process. A second submit
 * would take the first one's attempt for its own and resume it while it
 * is still going: it is refused instead. The host is one process per
 * machine (the single-instance lock), so this is the whole claim.
 */
const running = new Set<string>();

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
): Promise<ReviewDrafts> {
  const viewer = assertSameContext(req, src);
  if (!src.publish) {
    throw new Error("This provider can't file a review from n10");
  }
  const dir = src.dir ?? defaultDraftDir();
  const claim = draftFilePath(dir, req.ref, viewer);
  if (running.has(claim)) {
    throw new Error('This review is already being submitted');
  }
  running.add(claim);
  try {
    return await submitClaimed(
      req,
      { ...src, publish: src.publish },
      dir,
      viewer
    );
  } finally {
    running.delete(claim);
  }
}

async function submitClaimed(
  req: SubmitReviewRequest,
  src: SubmitSources & { publish: NonNullable<SubmitSources['publish']> },
  dir: string,
  viewer: string | null
): Promise<ReviewDrafts> {
  const now = src.now ?? Date.now;
  const drafts = new DraftsFile(dir, req.ref, viewer);
  const file = drafts.read();
  const chosen = choose(file, req.draftIds);
  const submission = toSubmission(req, chosen);
  const attempt = file.submission?.attempt ?? randomUUID();

  drafts.update((f) => ({
    ...f,
    drafts: f.drafts.map((d) =>
      publicationFor(d, chosen, file.submission?.draftIds ?? [], attempt, now())
    ),
    submission: {
      attempt,
      draftIds: chosen.map((d) => d.id),
      ledger: f.submission?.ledger ?? null,
    },
  }));

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
    settle(drafts, chosen, attempt, (d) => ({
      state: 'published',
      attempt,
      remoteId: published.items[d.id] ?? published.reviewId,
      at: now(),
    }));
    drafts.update((f) => ({ ...f, submission: undefined }));
  } catch (err) {
    const unanswered = ledger.read()?.inFlight != null;
    settle(
      drafts,
      chosen,
      attempt,
      afterFailure(err, unanswered, attempt, now())
    );
    throw err;
  }
  return { ref: req.ref, viewer, drafts: drafts.read().drafts };
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

/** A chosen draft goes out under `attempt`; one an earlier attempt
 *  had chosen and this one did not is back to unpublished. */
function publicationFor(
  d: ReviewDraft,
  chosen: ReviewDraft[],
  before: string[],
  attempt: string,
  at: number
): ReviewDraft {
  if (chosen.some((c) => c.id === d.id)) {
    return { ...d, publication: { state: 'publishing', attempt, since: at } };
  }
  if (before.includes(d.id)) {
    return { ...d, publication: { state: 'unpublished' } };
  }
  return d;
}

function settle(
  drafts: DraftsFile,
  chosen: ReviewDraft[],
  attempt: string,
  outcome: (d: ReviewDraft) => Publication
): void {
  const ids = new Set(chosen.map((d) => d.id));
  drafts.update((f) => ({
    ...f,
    drafts: f.drafts.map((d) =>
      ids.has(d.id) &&
      d.publication.state === 'publishing' &&
      d.publication.attempt === attempt
        ? { ...d, publication: outcome(d) }
        : d
    ),
  }));
}

/**
 * Where a draft stands after a failed attempt. Unanswered: it may be in
 * the review, so it is looked for next time. Refused: the provider's
 * reason, and it can be edited. Stopped before any write (the pull
 * request moved on, a pending review of the reviewer's own): as it was.
 */
function afterFailure(
  err: unknown,
  unanswered: boolean,
  attempt: string,
  at: number
): (d: ReviewDraft) => Publication {
  const reason = err instanceof Error ? err.message : String(err);
  // A step of this or an earlier attempt is still unaccounted for.
  if (unanswered) return () => ({ state: 'unknown', attempt, since: at });
  if (isReviewPublishError(err)) {
    if (err.failure === 'refused') {
      return () => ({ state: 'failed', attempt, reason, at });
    }
    return () => ({ state: 'unpublished' });
  }
  // The read before any write failed: nothing was sent.
  return () => ({ state: 'failed', attempt, reason, at });
}
