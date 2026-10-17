import { commentBodyParts } from '@n10/review-comments/conventional';
import type {
  ConversationComment,
  ConversationEvent,
  ReviewSummary,
} from '../../../host/contract.js';
import { firstNonEmptyLine } from '../diff/thread-model.js';

/**
 * What an activity entry says, in words. The actor is shown beside the
 * sentence, so each sentence starts at the verb: "approved", "added 3
 * commits", "requested review from Core (team)".
 */

const short = (oid: string | null | undefined) => oid?.slice(0, 7) ?? '?';

/** Azure's votes, in Azure's own words. */
const VOTES: Record<number, string> = {
  10: 'approved',
  5: 'approved with suggestions',
  0: 'reset their vote',
  [-5]: 'is waiting for the author',
  [-10]: 'rejected',
};

type Of<K extends ConversationEvent['kind']> = Extract<
  ConversationEvent,
  { kind: K }
>;

function reviewerName(e: Of<'review-requested' | 'review-request-removed'>) {
  if (!e.reviewer) return 'someone';
  return e.reviewer.kind === 'team'
    ? `${e.reviewer.name} (team)`
    : e.reviewer.name;
}

/** Azure's own sentence for an entry, or the kind when it wrote none. */
const asWritten = (e: Of<'push' | 'status-changed' | 'system'>) =>
  e.text ?? e.kind;

const SENTENCES: {
  [K in ConversationEvent['kind']]: (e: Of<K>) => string;
} = {
  commit: (e) => `committed ${e.headline ?? short(e.commit)}`,
  'force-push': (e) => `force-pushed ${short(e.before)} → ${short(e.after)}`,
  'base-changed': (e) =>
    `changed the base branch from ${e.from ?? '?'} to ${e.to ?? '?'}`,
  'review-requested': (e) => `requested review from ${reviewerName(e)}`,
  'review-request-removed': (e) =>
    `removed the review request for ${reviewerName(e)}`,
  'review-dismissed': (e) =>
    e.message ? `dismissed a review: ${e.message}` : 'dismissed a review',
  'ready-for-review': () => 'marked this ready for review',
  'converted-to-draft': () => 'converted this to a draft',
  closed: () => 'closed this',
  reopened: () => 'reopened this',
  merged: (e) =>
    e.commit ? `merged this as ${short(e.commit)}` : 'merged this',
  vote: (e) =>
    (e.vote != null ? VOTES[e.vote] : undefined) ?? e.text ?? 'voted',
  push: asWritten,
  'status-changed': asWritten,
  system: asWritten,
};

export function eventSentence(e: ConversationEvent): string {
  return (SENTENCES[e.kind] as (e: ConversationEvent) => string)(e);
}

/** Azure writes its history entries as full sentences that name the
 *  actor ("Bea Reviewer voted 10"); those are shown as written. */
export function writesOwnActor(e: ConversationEvent): boolean {
  return (
    (e.kind === 'push' || e.kind === 'status-changed' || e.kind === 'system') &&
    e.text != null
  );
}

const REVIEW_VERB: Record<ReviewSummary['state'], string> = {
  approved: 'approved',
  'changes-requested': 'requested changes',
  commented: 'reviewed',
  dismissed: 'reviewed (dismissed)',
  pending: 'started a review',
};

export function reviewSentence(r: ReviewSummary): string {
  const comments =
    r.commentCount > 0
      ? ` with ${r.commentCount} comment${r.commentCount === 1 ? '' : 's'}`
      : '';
  return `${REVIEW_VERB[r.state]}${comments}`;
}

/** "Hidden as off topic.", in the provider's own reason where it gave one. */
export function hiddenLabel(reason: string | null): string {
  return reason ? `Hidden as ${reason.replace(/_/g, ' ')}.` : 'Hidden.';
}

/**
 * One line for a folded thread, by the rules its body follows: hidden
 * text stays hidden until the reader opens it, and a deleted comment
 * says so rather than showing nothing.
 */
export function commentPreview(c: ConversationComment): string {
  if (c.deleted) return 'This comment was deleted.';
  if (c.minimized) return hiddenLabel(c.minimized.reason);
  return c.kind === 'system'
    ? firstNonEmptyLine(c.body)
    : firstNonEmptyLine(commentBodyParts(c.body).body);
}

/** "Alex added 3 commits", for one author's run of them. */
export function commitsSentence(count: number): string {
  return `added ${count} commits`;
}
