import type {
  PullRequestConversation,
  PullRequestRef,
  ReadOutcome,
} from '@n10/vcs-core';
import {
  assertSameContext,
  readAbout,
  type SnapshotRequest,
  type SnapshotSources,
} from './pr-snapshot.js';

/**
 * A pull request's conversation, read by identity.
 *
 * The same contract as the snapshot: the answer echoes the ref and the
 * account it was read as, and it is refused outright when the open
 * repository or the account is not the one asked about, before or
 * after the read. A read that fails keeps its kind and retry time, so
 * the reader can say "rate limited, retrying at…" instead of showing an
 * empty conversation.
 */
export interface PullRequestConversationRead {
  ref: PullRequestRef;
  viewer: string | null;
  fetchedAt: number;
  conversation: ReadOutcome<PullRequestConversation>;
}

export interface ConversationSources
  extends Pick<SnapshotSources, 'repository' | 'viewer' | 'now'> {
  /** Absent when the provider has no conversation read. */
  conversation?: (prId: number) => Promise<PullRequestConversation>;
}

export async function readPullRequestConversation(
  req: SnapshotRequest,
  src: ConversationSources
): Promise<PullRequestConversationRead> {
  const viewer = assertSameContext(req, src);
  const conversation = await readAbout(
    req.ref,
    src.conversation,
    "The conversation isn't available for this repository"
  );
  // Asked again after the read, as the account it started as.
  assertSameContext({ ...req, viewer }, src);
  return {
    ref: req.ref,
    viewer,
    fetchedAt: (src.now ?? Date.now)(),
    conversation,
  };
}
