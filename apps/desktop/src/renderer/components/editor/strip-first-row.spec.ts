import { describe, expect, it } from 'vitest';
import { firstRowEnd } from './strip-first-row.js';

describe('firstRowEnd', () => {
  it('ends the first row at the last block that fits with the actions after it', () => {
    // 100 + 100 + 100 = 300, and 48 more for the actions: 348 ≤ 360.
    expect(firstRowEnd([100, 100, 100, 100], 360, 48)).toBe(2);
    // The third would leave the actions 47px: it breaks to the next row.
    expect(firstRowEnd([100, 100, 100, 100], 347, 48)).toBe(1);
  });

  it('decides from the unstretched widths, so its own margin keeps the break', () => {
    const widths = [120, 90, 150, 80];
    const at = firstRowEnd(widths, 400, 48);
    // With the margin in, the row is the same: the next block still
    // does not fit, and these do.
    const row = widths.slice(0, at + 1).reduce((a, b) => a + b, 0) + 48;
    expect(row).toBeLessThanOrEqual(400);
    expect(row + widths[at + 1]!).toBeGreaterThan(400);
  });

  it('keeps a first block too wide for the row on it, and takes all when all fit', () => {
    expect(firstRowEnd([500, 100], 300, 48)).toBe(0);
    expect(firstRowEnd([50, 50, 0], 300, 48)).toBe(2);
  });
});
