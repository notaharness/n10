import type { QueryClient } from '@tanstack/react-query';

/**
 * Whether a read is still running for data nothing on screen or held
 * ready observes any more: a pane let go of, or closed, before its
 * reads came back. The host keeps working on those whether anyone
 * wants the answer or not, since a call to it cannot be taken back.
 */
export function hasOrphanedFetch(client: QueryClient): boolean {
  return client
    .getQueryCache()
    .getAll()
    .some(
      (q) => q.state.fetchStatus === 'fetching' && q.getObserversCount() === 0
    );
}
