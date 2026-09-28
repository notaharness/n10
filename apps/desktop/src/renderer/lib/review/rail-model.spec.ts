import { describe, expect, it } from 'vitest';
import { RAIL_SHOWN, railAtWidth, railByReader } from './rail-model.js';

/** The rail collapses for a narrow workspace as the reader's control
 *  would, and only gives back what the width took. */

describe('railAtWidth', () => {
  it('collapses when the workspace turns narrow, and shows again when it widens', () => {
    const narrow = railAtWidth(RAIL_SHOWN, true);
    expect(narrow).toEqual({ hidden: true, auto: true, narrow: true });
    expect(railAtWidth(narrow, false)).toEqual(RAIL_SHOWN);
  });

  it('keeps what the reader chose', () => {
    // Shown again by the reader while narrow: it stays shown.
    const shown = railByReader(railAtWidth(RAIL_SHOWN, true), false);
    expect(railAtWidth(shown, true)).toBe(shown);
    expect(railAtWidth(shown, false).hidden).toBe(false);
    // Collapsed by the reader: widening does not show it.
    const hidden = railByReader(RAIL_SHOWN, true);
    expect(railAtWidth(railAtWidth(hidden, true), false).hidden).toBe(true);
  });
});
