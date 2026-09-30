import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOVER_INTENT_INTERVAL_MS as INTERVAL,
  HOVER_INTENT_SENSITIVITY_PX as SENSITIVITY,
  HoverIntent,
} from './hover-intent.js';

describe('HoverIntent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function tracked() {
    const settled = vi.fn();
    return { settled, intent: new HoverIntent() };
  }

  it('settles at the first sample when the pointer stayed put', () => {
    const { settled, intent } = tracked();
    intent.enter({ x: 10, y: 10 }, settled);
    vi.advanceTimersByTime(INTERVAL - 1);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settled).toHaveBeenCalledOnce();
    expect(intent.sampling).toBe(false);
  });

  it('settles on movement under the sensitivity, by straight-line distance', () => {
    const { settled, intent } = tracked();
    intent.enter({ x: 0, y: 0 }, settled);
    // 4 across and 4 down: 8 as |dx|+|dy|, but about 5.7 in a line.
    intent.move({ x: 4, y: 4 });
    vi.advanceTimersByTime(INTERVAL);
    expect(settled).toHaveBeenCalledOnce();
  });

  it('keeps sampling while the pointer moves, and settles once it slows', () => {
    const { settled, intent } = tracked();
    intent.enter({ x: 0, y: 0 }, settled);
    for (let i = 1; i <= 5; i++) {
      intent.move({ x: 0, y: i * SENSITIVITY });
      vi.advanceTimersByTime(INTERVAL);
    }
    expect(settled).not.toHaveBeenCalled();
    // Moved less than the sensitivity over the last interval.
    intent.move({ x: 0, y: 5 * SENSITIVITY + 2 });
    vi.advanceTimersByTime(INTERVAL);
    expect(settled).toHaveBeenCalledOnce();
  });

  it('compares with the last sample, not with where the pointer came in', () => {
    const { settled, intent } = tracked();
    intent.enter({ x: 0, y: 0 }, settled);
    intent.move({ x: 0, y: 20 });
    vi.advanceTimersByTime(INTERVAL);
    expect(settled).not.toHaveBeenCalled();
    // Still at 20: nothing since the last sample, far from the entry.
    vi.advanceTimersByTime(INTERVAL);
    expect(settled).toHaveBeenCalledOnce();
  });

  it('does nothing once cancelled', () => {
    const { settled, intent } = tracked();
    intent.enter({ x: 0, y: 0 }, settled);
    intent.cancel();
    vi.advanceTimersByTime(10 * INTERVAL);
    expect(settled).not.toHaveBeenCalled();
    expect(intent.sampling).toBe(false);
  });
});
