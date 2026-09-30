import { describe, expect, it } from 'vitest';
import {
  NOTHING_SHOWN,
  panesFor,
  shownIdFor,
  spareFor,
  type Shown,
} from './editor-panes.js';
import type { Tab } from './tabs-model.js';

const REPO = '/repo';
const item = (id: string, repo = REPO): Tab => ({
  id,
  kind: 'item',
  repo,
  itemKey: `branch:${id}`,
  preview: false,
});
const [a, b, c] = [item('a'), item('b'), item('c')];

describe('spareFor', () => {
  it('holds the tab left last while it is open', () => {
    const shown: Shown = { tab: b, left: a, seq: 1 };
    expect(spareFor(shown, { tab: null, seq: 1, onStrip: false }, [a, b])).toBe(
      a
    );
    expect(
      spareFor(shown, { tab: null, seq: 1, onStrip: false }, [b])
    ).toBeNull();
  });

  it('holds a tab hovered since the last switch instead', () => {
    const shown: Shown = { tab: b, left: a, seq: 1 };
    expect(spareFor(shown, { tab: c, seq: 2, onStrip: true }, [a, b, c])).toBe(
      c
    );
    // The hover let go of it: nothing, not the tab left last again.
    expect(
      spareFor(shown, { tab: null, seq: 3, onStrip: false }, [a, b, c])
    ).toBeNull();
  });

  it('lets go of a hovered tab that has closed, but not of a row', () => {
    const shown: Shown = { tab: b, left: a, seq: 1 };
    // A tab on the strip, closed under the pointer.
    expect(
      spareFor(shown, { tab: c, seq: 2, onStrip: true }, [a, b])
    ).toBeNull();
    // A sidebar row: its tab opens only when the row is clicked.
    expect(spareFor(shown, { tab: c, seq: 2, onStrip: false }, [a, b])).toBe(c);
  });

  it('holds nothing before anything was shown', () => {
    expect(
      spareFor(NOTHING_SHOWN, { tab: null, seq: 0, onStrip: false }, [a])
    ).toBeNull();
  });
});

describe('shownIdFor', () => {
  it('waits for the deferred render to mount a tab', () => {
    expect(
      shownIdFor({ activeId: 'c', deferredId: 'b', spare: a, shown: b })
    ).toBe('b');
  });

  it('shows the spare at once', () => {
    expect(
      shownIdFor({ activeId: 'a', deferredId: 'b', spare: a, shown: b })
    ).toBe('a');
  });

  it('keeps a tab it swapped in while the deferred id catches up', () => {
    // After the swap to `a`, `b` is the spare and the deferred id still
    // says `b`: showing `b` again would swap back and forth for ever.
    expect(
      shownIdFor({ activeId: 'a', deferredId: 'b', spare: b, shown: a })
    ).toBe('a');
  });
});

describe('panesFor', () => {
  it('renders the pane on screen and the spare, in id order', () => {
    expect(panesFor(b, a, REPO)).toEqual([a, b]);
    expect(panesFor(a, b, REPO)).toEqual([a, b]);
  });

  it('renders neither a repeat of the pane on screen nor another repository', () => {
    expect(panesFor(a, a, REPO)).toEqual([a]);
    expect(panesFor(a, item('x', '/other'), REPO)).toEqual([a]);
    expect(panesFor(item('x', '/other'), a, REPO)).toEqual([a]);
  });
});
