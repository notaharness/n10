import { useCallback, useSyncExternalStore } from 'react';
import type { RevisionChoice } from './revision-model.js';

/**
 * The changes each pull request's diff shows (`revision-model.ts`), for
 * the life of the renderer: kept outside the pane, like its pinned
 * revision (`pinned-revisions.ts`), so a reader who leaves a pull
 * request in "since your last review" comes back to it there. The
 * selector always says which it is.
 */

const choices = new Map<string, RevisionChoice>();
const listeners = new Set<() => void>();

const ALL: RevisionChoice = { mode: 'all' };

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setRevisionChoice(key: string, choice: RevisionChoice): void {
  choices.set(key, choice);
  for (const listener of listeners) listener();
}

/** `key` is the pull request's `pinKey`. */
export function useRevisionChoice(
  key: string
): [RevisionChoice, (choice: RevisionChoice) => void] {
  const choice = useSyncExternalStore(subscribe, () => choices.get(key) ?? ALL);
  const set = useCallback(
    (next: RevisionChoice) => setRevisionChoice(key, next),
    [key]
  );
  return [choice, set];
}
