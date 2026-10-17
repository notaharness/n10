import { describe, expect, it } from 'vitest';
import type { ReadState } from './read-state.js';
import { nextHeldFailure, withHeldFailure } from './use-read-state.js';

type S = ReadState<string>;

const FAILED: S = { kind: 'failed', error: 'GitHub is down' };
const LOADING: S = { kind: 'loading' };
const READY: S = { kind: 'ready', data: 'Body', stale: null };
const A = '["pr-description","/repo",1]';
const B = '["pr-description","/repo",2]';

describe('holding a failure through its retry', () => {
  it('shows the last failure while a retry is in flight', () => {
    // TanStack resets the error when a query with no data refetches.
    const held = nextHeldFailure<S>(null, FAILED, A);
    const next = nextHeldFailure<S>(held, LOADING, A);
    expect(withHeldFailure<S>(LOADING, next, true)).toBe(FAILED);
  });

  it('shows loading once nothing is fetching, and before any failure', () => {
    expect(withHeldFailure<S>(LOADING, { key: A, state: FAILED }, false)).toBe(
      LOADING
    );
    expect(
      withHeldFailure<S>(LOADING, nextHeldFailure<S>(null, LOADING, A), true)
    ).toBe(LOADING);
  });

  it('lets data replace the failure and forgets it', () => {
    expect(nextHeldFailure<S>({ key: A, state: FAILED }, READY, A)).toBeNull();
    expect(withHeldFailure<S>(READY, null, true)).toBe(READY);
  });

  it('holds the newest failure, not the first', () => {
    const next: S = { kind: 'failed', error: 'Still down' };
    expect(nextHeldFailure<S>({ key: A, state: FAILED }, next, A)).toEqual({
      key: A,
      state: next,
    });
  });

  it("never shows one read's failure while another read loads", () => {
    // The pane moved to another pull request mid-failure.
    const held = nextHeldFailure<S>({ key: A, state: FAILED }, LOADING, B);
    expect(held).toBeNull();
    expect(withHeldFailure<S>(LOADING, held, true)).toBe(LOADING);
  });
});
