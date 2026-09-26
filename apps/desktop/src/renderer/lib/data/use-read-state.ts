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

/** The failure to keep showing after this render. */
export function nextHeldFailure<S extends Kinded>(
  held: S | null,
  state: S
): S | null {
  if (state.kind === 'failed') return state;
  return state.kind === 'loading' ? held : null;
}

/** What to render: the held failure while the read is going again. */
export function withHeldFailure<S extends Kinded>(
  state: S,
  held: S | null,
  fetching: boolean
): S {
  return state.kind === 'loading' && fetching && held ? held : state;
}

function sameState(a: Kinded | null, b: Kinded | null): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function useHeldFailure<S extends Kinded>(
  state: S,
  fetching: boolean
): S {
  const [held, setHeld] = useState<S | null>(null);
  const next = nextHeldFailure(held, state);
  // Adjusted during render, compared by value: the state is rebuilt on
  // every render and an identity check would never settle.
  if (!sameState(next, held)) setHeld(next);
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

/** A section's read, its held failure, and its Retry. */
export function useReadState<T>(
  query: QueryLike<T> & {
    isFetching: boolean;
    refetch: () => Promise<unknown>;
  }
): { state: ReadState<T>; retrying: boolean; retry: () => void } {
  const state = useHeldFailure(readState(query), query.isFetching);
  const { retrying, retry } = useRetry(() => query.refetch());
  return { state, retrying, retry };
}
