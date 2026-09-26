import { describe, expect, it } from 'vitest';
import type { ReadState } from './read-state.js';
import { nextHeldFailure, withHeldFailure } from './use-read-state.js';

type S = ReadState<string>;

const FAILED: S = { kind: 'failed', error: 'GitHub is down' };
const LOADING: S = { kind: 'loading' };
const READY: S = { kind: 'ready', data: 'Body', stale: null };

describe('holding a failure through its retry', () => {
  it('shows the last failure while a retry is in flight', () => {
    // TanStack resets the error when a query with no data refetches.
    const held = nextHeldFailure<S>(null, FAILED);
    expect(
      withHeldFailure<S>(LOADING, nextHeldFailure<S>(held, LOADING), true)
    ).toBe(FAILED);
  });

  it('shows loading once nothing is fetching, and before any failure', () => {
    expect(withHeldFailure<S>(LOADING, FAILED, false)).toBe(LOADING);
    expect(
      withHeldFailure<S>(LOADING, nextHeldFailure<S>(null, LOADING), true)
    ).toBe(LOADING);
  });

  it('lets data replace the failure and forgets it', () => {
    expect(nextHeldFailure<S>(FAILED, READY)).toBeNull();
    expect(withHeldFailure<S>(READY, null, true)).toBe(READY);
  });

  it('holds the newest failure, not the first', () => {
    const next: S = { kind: 'failed', error: 'Still down' };
    expect(nextHeldFailure<S>(FAILED, next)).toBe(next);
  });
});
