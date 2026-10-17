import { parseAnchor, type DraftAnchor } from './review-draft-anchor.js';

/**
 * A reviewer's own unpublished writing on one pull request: a reply to
 * a thread, a new conversation comment, the review summary. Private to
 * the account that wrote it, kept on this machine until it is published
 * or discarded, and never sent anywhere on its own.
 *
 * Agent findings are not drafts in this sense: the review agent writes
 * those through `n10 util add-comment` into `@n10/review-comments`,
 * where they keep their own attribution.
 */

/** What a draft will become when it is published. An inline draft is
 *  one of many on its pull request, told apart by a key its writer
 *  chose; the others are one per target. */
export type DraftTarget =
  | { kind: 'reply'; threadId: string }
  | { kind: 'general' }
  | { kind: 'summary' }
  | { kind: 'inline'; key: string; anchor: DraftAnchor };

/**
 * Where publishing a draft has got to. A write whose answer never came
 * back is `unknown`, not failed: the provider may have taken it, so it
 * is looked for before it is sent again.
 */
export type Publication =
  | { state: 'unpublished' }
  | { state: 'publishing'; attempt: string; since: number }
  | { state: 'published'; attempt: string; remoteId: string; at: number }
  | { state: 'unknown'; attempt: string; since: number }
  | { state: 'failed'; attempt: string; reason: string; at: number };

export interface ReviewDraft {
  /** One per target: a thread has one reply draft, a review one summary,
   *  an inline comment one draft per key. */
  id: string;
  target: DraftTarget;
  /** Exactly as typed, whitespace and all. */
  body: string;
  createdAt: number;
  updatedAt: number;
  publication: Publication;
}

/** What happened to one attempt to publish a draft. */
export type PublicationEvent =
  | { kind: 'begin'; attempt: string; at: number }
  | { kind: 'confirmed'; attempt: string; remoteId: string; at: number }
  | { kind: 'rejected'; attempt: string; reason: string; at: number }
  | { kind: 'lost'; attempt: string; at: number }
  /** An unknown outcome looked for: found as `remoteId`, or not there. */
  | {
      kind: 'reconciled';
      attempt: string;
      remoteId: string | null;
      at: number;
    };

/** A target from untrusted input. Throws on anything off. */
export function parseTarget(value: unknown): DraftTarget {
  const target = (value ?? {}) as Record<string, unknown>;
  if (target['kind'] === 'general' || target['kind'] === 'summary') {
    return { kind: target['kind'] };
  }
  const threadId = target['threadId'];
  if (
    target['kind'] === 'reply' &&
    typeof threadId === 'string' &&
    threadId.length > 0
  ) {
    return { kind: 'reply', threadId };
  }
  if (target['kind'] === 'inline' && isKey(target['key'])) {
    return {
      kind: 'inline',
      key: target['key'],
      anchor: parseAnchor(target['anchor']),
    };
  }
  throw new TypeError('Invalid draft target');
}

/** A key the writer chose: a UUID, or anything as plain. */
function isKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value);
}

export function draftId(target: DraftTarget): string {
  switch (target.kind) {
    case 'reply':
      return `reply:${target.threadId}`;
    case 'inline':
      return `inline:${target.key}`;
    default:
      return target.kind;
  }
}

/** Text can change only while nothing may have been sent. */
export function isEditable(draft: ReviewDraft): boolean {
  const { state } = draft.publication;
  return state === 'unpublished' || state === 'failed';
}

/**
 * The draft after `event`. Throws on an event that does not follow:
 * a second attempt while one is in flight or unaccounted for would
 * publish the draft twice.
 */
export function recordPublication(
  draft: ReviewDraft,
  event: PublicationEvent
): ReviewDraft {
  const at = (publication: Publication): ReviewDraft => ({
    ...draft,
    publication,
  });
  const current = draft.publication;
  if (event.kind === 'begin') {
    if (!isEditable(draft)) throw outOfOrder(draft, event);
    return at({ state: 'publishing', attempt: event.attempt, since: event.at });
  }
  const expected = event.kind === 'reconciled' ? 'unknown' : 'publishing';
  if (current.state !== expected || current.attempt !== event.attempt) {
    throw outOfOrder(draft, event);
  }
  return at(settled(event));
}

function settled(event: Exclude<PublicationEvent, { kind: 'begin' }>) {
  const { attempt, at } = event;
  switch (event.kind) {
    case 'confirmed':
      return {
        state: 'published',
        attempt,
        remoteId: event.remoteId,
        at,
      } as const;
    case 'rejected':
      return { state: 'failed', attempt, reason: event.reason, at } as const;
    case 'lost':
      return { state: 'unknown', attempt, since: at } as const;
    case 'reconciled':
      return event.remoteId === null
        ? ({
            state: 'failed',
            attempt,
            reason: 'It was not posted',
            at,
          } as const)
        : ({
            state: 'published',
            attempt,
            remoteId: event.remoteId,
            at,
          } as const);
  }
}

function outOfOrder(draft: ReviewDraft, event: PublicationEvent): Error {
  return new Error(
    `Cannot record "${event.kind}" for a draft that is ${draft.publication.state}`
  );
}
