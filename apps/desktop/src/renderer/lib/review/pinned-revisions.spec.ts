import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetPinsForTests,
  movedFrom,
  pinKey,
  readPin,
  setPin,
  shouldFollow,
  updatePin,
  type PinnedRevision,
} from './pinned-revisions.js';

/**
 * The pin is what keeps a diff at the revision the reader opened,
 * across a pane that unmounts. It must never carry one pull request's
 * revision over to another, and only the reader moves one they saw.
 */

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

beforeEach(() => __resetPinsForTests());

describe('pinned revisions', () => {
  it('keys by repository and pull request', () => {
    setPin(pinKey('/repo/a', 10), { head: A, target: 'main' });
    expect(readPin(pinKey('/repo/a', 10))).toEqual({ head: A, target: 'main' });
    // The same number in another repository, and another pull request
    // in the same one — a tab that followed its worktree — are strangers.
    expect(readPin(pinKey('/repo/b', 10))).toBeUndefined();
    expect(readPin(pinKey('/repo/a', 11))).toBeUndefined();
  });

  it('adds the resolved target and the first showing to a stored pin only', () => {
    const key = pinKey('/repo/a', 10);
    updatePin(key, { shown: true });
    expect(readPin(key)).toBeUndefined();
    setPin(key, { head: A, target: 'main' });
    updatePin(key, { targetOid: B });
    updatePin(key, { shown: true });
    expect(readPin(key)).toEqual({
      head: A,
      target: 'main',
      targetOid: B,
      shown: true,
    });
  });
});

describe('movedFrom', () => {
  const pin: PinnedRevision = { head: A, target: 'main' };

  it('is nothing while the provider reports the pinned revision', () => {
    expect(movedFrom(pin, { head: A, target: 'main' })).toBeNull();
  });

  it('names a new head', () => {
    expect(movedFrom(pin, { head: B, target: 'main' })).toEqual({
      head: B,
      target: null,
      readingTarget: 'main',
    });
  });

  it('names a retarget, which moves the base as surely as a push', () => {
    expect(movedFrom(pin, { head: A, target: 'release' })).toEqual({
      head: null,
      target: 'release',
      readingTarget: 'main',
    });
  });

  it('does not call a head moved when either side has none', () => {
    expect(movedFrom(pin, { head: undefined, target: 'main' })).toBeNull();
    expect(
      movedFrom(
        { head: undefined, target: 'main' },
        { head: B, target: 'main' }
      )
    ).toBeNull();
  });
});

describe('shouldFollow', () => {
  const moved = { head: B, target: null, readingTarget: 'main' };

  it('follows a pin whose read failed before anything was shown', () => {
    expect(shouldFollow({ head: A, target: 'main' }, moved, true)).toBe(true);
  });

  it('never moves a pin the reader has seen, even when a re-read fails', () => {
    expect(
      shouldFollow({ head: A, target: 'main', shown: true }, moved, true)
    ).toBe(false);
  });

  it('waits while the read is fine, or while nothing newer is reported', () => {
    expect(shouldFollow({ head: A, target: 'main' }, moved, false)).toBe(false);
    expect(shouldFollow({ head: A, target: 'main' }, null, true)).toBe(false);
  });
});
