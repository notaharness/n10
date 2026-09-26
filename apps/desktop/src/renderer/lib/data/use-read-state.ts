import { useState } from 'react';
import { readState, type QueryLike, type ReadState } from './read-state.js';

/**
 * A failure stays on screen while its read goes again.
 *
 * TanStack drops a query's error the moment it refetches with no data
 * to fall back on, so the read turns back into "loading". Left alone,
 * pressing Retry would swap the alert for a skeleton: the Retry button
 * the reader just pressed unmounts under their pointer, keyboard focus
 * falls to the page, and a worktree diff that never loaded flickers
 * between alert and skeleton on every poll. Holding the last failure
 * until the read settles keeps the section — and the button — in place.
 */

interface Kinded {
  kind: string;
}

/**
 * A failure held for one read. The key is that read's query key: a pane
 * can be handed a different pull request while a failure is held — a
 * `git switch` in its worktree moves the tab — and one pull request's
 * error must never stand in for another's loading.
 */
export interface HeldFailure<S> {
  key: string;
  state: S;
}

/** The failure to keep showing after this render. */
export function nextHeldFailure<S extends Kinded>(
  held: HeldFailure<S> | null,
  state: S,
  key: string
): HeldFailure<S> | null {
  if (state.kind === 'failed') return { key, state };
  return state.kind === 'loading' && held?.key === key ? held : null;
}

/** What to render: the held failure while the read is going again. */
export function withHeldFailure<S extends Kinded>(
  state: S,
  held: HeldFailure<S> | null,
  fetching: boolean
): S {
  return state.kind === 'loading' && fetching && held ? held.state : state;
}

function sameHeld(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** `key` is the read's query key. */
export function useHeldFailure<S extends Kinded>(
  state: S,
  fetching: boolean,
  key: readonly unknown[]
): S {
  const [held, setHeld] = useState<HeldFailure<S> | null>(null);
  const next = nextHeldFailure(held, state, JSON.stringify(key));
  // Adjusted during render, compared by value: the state is rebuilt on
  // every render and an identity check would never settle.
  if (!sameHeld(next, held)) setHeld(next);
  return withHeldFailure(state, next, fetching);
}

/**
 * A retry the reader started, as opposed to a poll: only theirs spins
 * the button, and a second press while one is in flight does nothing.
 */
export function useRetry(run: () => Promise<unknown>) {
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    const done = () => setRetrying(false);
    // Both handlers attached: the chain cannot reject.
    void run().then(done, done);
  };
  return { retrying, retry };
}

/** A section's read, its held failure, and its Retry. `key` is the
 *  read's query key. */
export function useReadState<T>(
  query: QueryLike<T> & {
    isFetching: boolean;
    refetch: () => Promise<unknown>;
  },
  key: readonly unknown[]
): { state: ReadState<T>; retrying: boolean; retry: () => void } {
  const state = useHeldFailure(readState(query), query.isFetching, key);
  const { retrying, retry } = useRetry(() => query.refetch());
  return { state, retrying, retry };
}
