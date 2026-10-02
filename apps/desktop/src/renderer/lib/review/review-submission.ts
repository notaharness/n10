import { CHANGES_EVENTS } from '@n10/vcs-core/review-publication';
import type {
  ReviewDraft,
  ReviewEvent,
  SubmittedReview,
} from '../../../host/contract.js';

/**
 * Finishing a review: the verdicts the provider files, which drafts go
 * with it, whether the reviewer may approve, and what became of the
 * last submit, read from the drafts file rather than guessed.
 */

export interface VerdictOption {
  event: ReviewEvent;
  label: string;
}

/** Each verdict in the provider's own terms. A provider declares only
 *  the ones it has, so GitHub's and Azure DevOps's never mix. */
const VERDICTS: Partial<Record<ReviewEvent, string>> = {
  COMMENT: 'Comment',
  APPROVE: 'Approve',
  APPROVE_WITH_SUGGESTIONS: 'Approve with suggestions',
  REQUEST_CHANGES: 'Request changes',
  WAIT_FOR_AUTHOR: 'Wait for author',
  REJECT: 'Reject',
};

/** The verdicts offered, in the provider's order. Resetting a vote is
 *  not finishing a review. */
export function verdictOptions(
  events: readonly ReviewEvent[]
): VerdictOption[] {
  return events.flatMap((event) => {
    const label = VERDICTS[event];
    return label ? [{ event, label }] : [];
  });
}

/** What the submit button says: the verdict it files. */
export function submitLabel(event: ReviewEvent): string {
  return event === 'COMMENT' ? 'Submit comment' : VERDICTS[event] ?? 'Submit';
}

const APPROVING: readonly ReviewEvent[] = [
  'APPROVE',
  'APPROVE_WITH_SUGGESTIONS',
];
export const approves = (event: ReviewEvent) => APPROVING.includes(event);

/**
 * Why the reviewer cannot approve, or null when they can: an approval
 * is filed on the commit they read, and only the pull request's current
 * head is worth approving. `ranged` says the diff shows a chosen range,
 * whose end is what was read.
 */
export function approvalBlock(
  shownHead: string | null,
  providerHead: string | undefined,
  ranged = false
): string | null {
  if (shownHead === null) return 'The changes are still loading.';
  if (!providerHead) return 'Refresh the pull request to approve.';
  if (shownHead === providerHead) return null;
  return ranged
    ? 'Choose changes up to the latest commit to approve.'
    : 'New commits were pushed since you opened this. Load them to approve.';
}

/** Why the review cannot go as it stands, or null: a comment posts
 *  something, and asking for changes says what. */
export function missingWords(event: ReviewEvent, says: boolean): string | null {
  if (says) return null;
  if (event === 'COMMENT')
    return 'Write a summary or choose a comment to post.';
  return CHANGES_EVENTS.includes(event)
    ? 'Say what needs to change: write a summary or choose a comment.'
    : null;
}

/** A draft going with the review, as the form lists it. */
export interface FileableDraft {
  draft: ReviewDraft;
  /** Part of an earlier submit whose outcome is not known: it goes
   *  again, and is looked for before anything is sent. */
  locked: boolean;
  /** A comment on code written on another commit than the one the
   *  review is filed on: its lines belong to that commit, so it stays
   *  out until it is placed again. The commit it was written on. */
  writtenOn: string | null;
}

const inFlight = (d: ReviewDraft) =>
  d.publication.state === 'publishing' || d.publication.state === 'unknown';
const unsent = (d: ReviewDraft) =>
  d.publication.state === 'unpublished' || d.publication.state === 'failed';

/** Comments on code and replies, in the order they were written. A
 *  conversation comment is posted on its own; the summary has its box. */
export function fileableDrafts(
  drafts: readonly ReviewDraft[],
  head: string | null
): FileableDraft[] {
  return drafts.flatMap((draft): FileableDraft[] => {
    const { target } = draft;
    if (target.kind !== 'inline' && target.kind !== 'reply') return [];
    const written = target.kind === 'inline' ? target.anchor.head : head;
    const writtenOn = written === head ? null : written ?? '';
    if (inFlight(draft)) return [{ draft, locked: true, writtenOn: null }];
    return unsent(draft) && draft.body.trim()
      ? [{ draft, locked: false, writtenOn }]
      : [];
  });
}

/** What the form chooses until the reviewer says otherwise: everything
 *  that can go. */
export function defaultChoice(fileable: readonly FileableDraft[]): string[] {
  return fileable
    .filter((f) => f.locked || f.writtenOn === null)
    .map((f) => f.draft.id);
}

/** What the form says about the last submit. */
export type SubmitOutcome =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'confirmed'; filed: number }
  /** The review was already on the provider; nothing new was sent. */
  | { kind: 'resumed'; state: string; filed: number }
  /** The provider refused it: nothing more was posted. */
  | { kind: 'refused'; reason: string }
  /** No answer came: some of it may be posted, and a retry looks first. */
  | { kind: 'unknown'; reason: string };

/** The review is on the provider: what was sent with it is posted. */
export const isFiled = (outcome: SubmitOutcome) =>
  outcome.kind === 'confirmed' || outcome.kind === 'resumed';

/** The comments a submit chose that the provider now holds; the
 *  summary is the review's own text. */
function filedOf(drafts: readonly ReviewDraft[], ids: readonly string[]) {
  return drafts.filter(
    (d) =>
      ids.includes(d.id) &&
      d.target.kind !== 'summary' &&
      d.publication.state === 'published'
  ).length;
}

export function outcomeOf(
  result: SubmittedReview,
  ids: readonly string[]
): SubmitOutcome {
  const filed = filedOf(result.drafts, ids);
  return result.resumed
    ? { kind: 'resumed', state: result.resumed.state, filed }
    : { kind: 'confirmed', filed };
}

/**
 * A rejected submit, told apart by the drafts file it left: a chosen
 * draft still being posted, or maybe posted, means no answer came.
 */
export function failureOf(
  reason: string,
  drafts: readonly ReviewDraft[],
  ids: readonly string[]
): SubmitOutcome {
  const pending = drafts.some((d) => ids.includes(d.id) && inFlight(d));
  return pending ? { kind: 'unknown', reason } : { kind: 'refused', reason };
}
