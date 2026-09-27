import type {
  ConversationActor,
  ConversationEvent,
  ConversationEventDetail,
  RequestedReviewer,
} from '@n10/vcs-core';
import { oidOf, toActor, type RawActor } from './pr-conversation-map.js';

/** A GitHub timeline entry, and its reading as a conversation event. */
export interface RawEvent {
  __typename: string;
  id?: string;
  createdAt?: string;
  actor?: RawActor | null;
  commit?: {
    oid: string;
    committedDate?: string;
    messageHeadline?: string;
    author?: { name: string | null; user: RawActor | null } | null;
  } | null;
  beforeCommit?: { oid: string } | null;
  afterCommit?: { oid: string } | null;
  previousRefName?: string;
  currentRefName?: string;
  requestedReviewer?: {
    __typename: string;
    login?: string;
    name?: string;
    combinedSlug?: string;
  } | null;
  dismissalMessage?: string | null;
}

type Detail = ConversationEventDetail;

function reviewer(raw: RawEvent): RequestedReviewer | null {
  const r = raw.requestedReviewer;
  if (r?.__typename === 'Team' && r.name) {
    return { kind: 'team', name: r.name, handle: r.combinedSlug ?? r.name };
  }
  return r?.login ? { kind: 'user', name: r.login, handle: r.login } : null;
}

/** What each timeline type says beyond who and when. A type not listed
 *  is one the reader did not ask for, and is left out. */
const DETAILS: Record<string, (raw: RawEvent) => Detail | null> = {
  PullRequestCommit: (raw) => {
    const commit = oidOf(raw.commit);
    if (!commit) return null;
    const author = raw.commit?.author;
    return {
      kind: 'commit',
      commit,
      headline: raw.commit?.messageHeadline ?? null,
      authorName: author?.user ? null : author?.name ?? null,
    };
  },
  HeadRefForcePushedEvent: (raw) => ({
    kind: 'force-push',
    before: oidOf(raw.beforeCommit),
    after: oidOf(raw.afterCommit),
  }),
  BaseRefChangedEvent: (raw) => ({
    kind: 'base-changed',
    from: raw.previousRefName ?? null,
    to: raw.currentRefName ?? null,
  }),
  ReviewRequestedEvent: (raw) => ({
    kind: 'review-requested',
    reviewer: reviewer(raw),
  }),
  ReviewRequestRemovedEvent: (raw) => ({
    kind: 'review-request-removed',
    reviewer: reviewer(raw),
  }),
  ReviewDismissedEvent: (raw) => ({
    kind: 'review-dismissed',
    message: raw.dismissalMessage ?? null,
  }),
  ReadyForReviewEvent: () => ({ kind: 'ready-for-review' }),
  ConvertToDraftEvent: () => ({ kind: 'converted-to-draft' }),
  ClosedEvent: () => ({ kind: 'closed' }),
  ReopenedEvent: () => ({ kind: 'reopened' }),
  MergedEvent: (raw) => ({ kind: 'merged', commit: oidOf(raw.commit) }),
};

/** A commit's author when GitHub links the commit to an account. A
 *  name git recorded is not an identity and stays in `authorName`. */
function actorOf(raw: RawEvent): ConversationActor | null {
  return raw.__typename === 'PullRequestCommit'
    ? toActor(raw.commit?.author?.user)
    : toActor(raw.actor);
}

export function toEvent(raw: RawEvent): ConversationEvent | null {
  const detail = DETAILS[raw.__typename]?.(raw);
  const id = raw.id ?? raw.commit?.oid;
  if (!detail || !id) return null;
  const at =
    raw.__typename === 'PullRequestCommit'
      ? raw.commit?.committedDate
      : raw.createdAt;
  return {
    id,
    actor: actorOf(raw),
    at: at ?? null,
    native: raw.__typename,
    ...detail,
  };
}
