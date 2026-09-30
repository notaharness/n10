import { describe, expect, it } from 'vitest';
import { remoteSyncIntervalMs } from './sync-interval.js';

describe('remoteSyncIntervalMs', () => {
  it('never polls the provider faster than the floor', () => {
    // A hand-edited config of 1 would otherwise hammer the API.
    expect(remoteSyncIntervalMs(1)).toBe(300_000);
    expect(remoteSyncIntervalMs(0)).toBe(300_000);
  });

  it.each([NaN, Infinity, -Infinity])(
    'uses the default for an invalid interval %s',
    (value) => {
      expect(remoteSyncIntervalMs(value)).toBe(remoteSyncIntervalMs(undefined));
    }
  );

  it('honours a longer interval, and falls back when unset', () => {
    expect(remoteSyncIntervalMs(7_200_000)).toBe(7_200_000);
    expect(remoteSyncIntervalMs(undefined)).toBeGreaterThanOrEqual(300_000);
  });
});
