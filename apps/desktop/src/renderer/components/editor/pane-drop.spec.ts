import { describe, expect, it } from 'vitest';
import { canSplit, zoneAt } from './pane-drop.js';

const box = { left: 100, top: 50, width: 1000, height: 400 };

describe('zoneAt', () => {
  it('reads a side within its band, at most 80px in', () => {
    expect(zoneAt(box, 179, 250)).toBe('left');
    expect(zoneAt(box, 181, 250)).toBe('centre');
    expect(zoneAt(box, 1050, 250)).toBe('right');
    // 20% of 400 is 80: the band is as deep as on the sides.
    expect(zoneAt(box, 600, 120)).toBe('top');
    expect(zoneAt(box, 600, 440)).toBe('bottom');
  });

  it('keeps a band 24px deep in a small pane', () => {
    const small = { left: 0, top: 0, width: 100, height: 100 };
    expect(zoneAt(small, 23, 50)).toBe('left');
    expect(zoneAt(small, 25, 50)).toBe('centre');
  });

  it('gives a corner to the side nearer in proportion, ties to the left', () => {
    // 10px from the left (1%), 10px from the top (2.5%): left.
    expect(zoneAt(box, 110, 60)).toBe('left');
    const square = { left: 0, top: 0, width: 400, height: 400 };
    expect(zoneAt(square, 10, 10)).toBe('left');
    expect(zoneAt(square, 390, 390)).toBe('right');
    expect(zoneAt(square, 100, 10)).toBe('top');
  });
});

describe('canSplit', () => {
  it('needs room for two panes and a separator', () => {
    expect(canSplit({ width: 484, height: 100 }, 'right')).toBe(true);
    expect(canSplit({ width: 483, height: 1000 }, 'left')).toBe(false);
    expect(canSplit({ width: 100, height: 364 }, 'bottom')).toBe(true);
    expect(canSplit({ width: 1000, height: 363 }, 'top')).toBe(false);
  });
});

