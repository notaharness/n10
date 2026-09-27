import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  MentionCandidate,
  PullRequestRef,
} from '../../../host/contract.js';
import { assertAnswerFor } from '../data/pr-snapshot-query.js';
import { keys } from '../data/query-keys.js';
import { useRepo } from '../repo-context.js';

/** Typing pauses this long before the provider is asked. */
const PAUSE_MS = 150;

/**
 * The names the provider gave for the tokens it offered, for showing a
 * stored `@<id>` by name. Only what a search has answered in this
 * session; an id nobody searched for stays as it is.
 */
export const mentionNames = new Map<string, string>();

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled;
}

async function search(
  ref: PullRequestRef,
  viewer: string | null,
  query: string
): Promise<MentionCandidate[]> {
  const answer = await window.n10.searchMentionCandidates({
    ref,
    viewer,
    query,
  });
  assertAnswerFor(ref, viewer, answer);
  for (const c of answer.candidates) mentionNames.set(c.token, c.displayName);
  return answer.candidates;
}

/**
 * Who the provider says matches what was typed after `@`, asked once
 * typing pauses. The last answer stays up while the next is asked, so
 * the list does not flicker empty between letters.
 */
export function useMentionSearch(
  ref: PullRequestRef | null,
  query: string | null
) {
  const { repo } = useRepo();
  const asked = useSettled(query, PAUSE_MS);
  const settled = asked === query;
  const result = useQuery({
    queryKey: keys.mentions(repo.cwd, ref!, repo.viewer, asked ?? ''),
    queryFn: () => search(ref!, repo.viewer, asked!),
    enabled: ref != null && !!asked,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  return { ...result, settled };
}
