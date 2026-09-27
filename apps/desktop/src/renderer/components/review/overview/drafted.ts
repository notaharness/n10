import { createContext, useContext } from 'react';

/** The threads the reader has an unsent reply draft on, so the
 *  Overview can say so and a half-written reply is not forgotten. */
export const DraftedThreads = createContext<ReadonlySet<string>>(new Set());

export function useHasDraftReply(threadId: string): boolean {
  return useContext(DraftedThreads).has(threadId);
}
