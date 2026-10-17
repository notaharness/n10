import { createContext, useContext } from 'react';

/**
 * Whether a comment arrived after the Overview first showed this
 * conversation. A reply to a thread already in view shows at once —
 * it belongs to that thread — so it is marked instead of held.
 */
export const NewSince = createContext<(commentId: string) => boolean>(
  () => false
);

export function useIsNew(): (commentId: string) => boolean {
  return useContext(NewSince);
}
