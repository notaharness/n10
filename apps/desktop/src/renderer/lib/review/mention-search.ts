import { useQuery } from '@tanstack/react-query';
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
 * typing pauses. `people` is only ever the answer for the query in the
 * box now: an earlier answer is never offered, so Enter cannot insert
 * someone found for other letters.
 */
export function useMentionSearch(
  ref: PullRequestRef | null,
  query: string | null
) {
  const { repo } = useRepo();
  const asked = useSettled(query, PAUSE_MS);
  const result = useQuery({
    queryKey: keys.mentions(repo.cwd, ref, repo.viewer, asked ?? ''),
    queryFn: () => search(ref!, repo.viewer, asked!),
    enabled: ref != null && !!asked,
    staleTime: 60_000,
  });
  return offered(asked, query, result);
}

/**
 * What the picker may offer: the answer for exactly the query in the
 * box, and nothing while it is still being asked — not the pause before
 * the question, and not an earlier answer shown in its place.
 */
/**
 * The mention is already one of the people offered, typed out in full
 * (`@alex` when `alex` is offered): there is nothing left to choose, so
 * the list gets out of the way. Typing on reopens it.
 */
export function typedInFull(
  query: string,
  people: readonly MentionCandidate[]
): boolean {
  const q = query.toLowerCase();
  return people.some((p) => p.handle.toLowerCase() === q);
}

export function offered(
  asked: string | null,
  query: string | null,
  result: {
    data?: MentionCandidate[];
    error: Error | null;
    isSuccess: boolean;
    isPlaceholderData: boolean;
    isFetching: boolean;
  }
) {
  const current =
    asked === query && result.isSuccess && !result.isPlaceholderData;
  return {
    people: current ? result.data ?? [] : [],
    waiting: asked !== query || result.isFetching,
    error: asked === query ? result.error : null,
  };
}
