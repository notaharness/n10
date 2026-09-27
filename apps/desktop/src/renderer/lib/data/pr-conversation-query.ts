import { useQuery } from '@tanstack/react-query';
import type { VcsErrorKind } from '@n10/vcs-core';
import type {
  PullRequestConversationRead,
  PullRequestRef,
} from '../../../host/contract.js';
import { assertAnswerFor } from './pr-snapshot-query.js';
import { keys } from './query-keys.js';

/**
 * A provider read that failed, with the provider's reason for it. The
 * query errors with this rather than resolving, so a failed read is
 * never mistaken for an empty conversation and data already on screen
 * is kept, labelled stale.
 */
export class ProviderReadError extends Error {
  constructor(
    message: string,
    readonly kind: VcsErrorKind,
    readonly retryAfterMs: number | undefined
  ) {
    super(message);
    this.name = 'ProviderReadError';
  }
}

/**
 * One pull request's whole conversation, by identity. Resolves with the
 * conversation, or with the provider's statement that it has none to
 * read; a failed read rejects with {@link ProviderReadError}.
 */
export async function loadPullRequestConversation(
  ref: PullRequestRef,
  viewer: string | null
): Promise<PullRequestConversationRead> {
  const answer = await window.n10.getPullRequestConversation({ ref, viewer });
  assertAnswerFor(ref, viewer, answer);
  const read = answer.conversation;
  if (read.state === 'failed') {
    throw new ProviderReadError(read.reason, read.kind, read.retryAfterMs);
  }
  return answer;
}

/** A rate limit or a rejected credential is not fixed by asking again
 *  straight away; anything else gets TanStack's usual retries. */
export function retryRead(failures: number, error: unknown): boolean {
  if (error instanceof ProviderReadError) {
    if (error.kind === 'throttled' || error.kind === 'auth') return false;
  }
  return failures < 3;
}

/** Placeholder while there is no ref; the query is disabled then. */
const NO_REF: PullRequestRef = {
  provider: '',
  host: '',
  repository: '',
  number: 0,
};

export function usePullRequestConversation(
  cwd: string,
  ref: PullRequestRef | null,
  viewer: string | null
) {
  return useQuery({
    queryKey: keys.prConversation(cwd, ref ?? NO_REF, viewer),
    queryFn: () => loadPullRequestConversation(ref!, viewer),
    enabled: ref != null,
    staleTime: 60_000,
    retry: retryRead,
  });
}
