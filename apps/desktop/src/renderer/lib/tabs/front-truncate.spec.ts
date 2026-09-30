import { describe, expect, it } from 'vitest';
import { dropLeading, ELLIPSIS, frontCut } from './front-truncate.js';

/** One unit per character, the ellipsis included. */
const mono = (s: string) => [...s].length;

describe('frontCut', () => {
  it('keeps a label that fits', () => {
    expect(frontCut('feat/tabs', 9, mono)).toBe(0);
  });

  it('drops just enough from the front for the ellipsis and the end', () => {
    const cut = frontCut('feature/tab-strip-wrap', 10, mono);
    expect(ELLIPSIS + 'feature/tab-strip-wrap'.slice(cut)).toBe('…trip-wrap');
  });

  it('keeps nothing when not even one character fits', () => {
    expect(frontCut('abc', 0.5, mono)).toBe(3);
  });

  it('never splits a character made of two code units', () => {
    expect(frontCut('ab😀', 2, mono)).toBe(2);
  });

  it('keeps the most that fits for widths that vary per character', () => {
    const wide = (s: string) =>
      [...s].reduce((w, c) => w + (c === 'W' ? 3 : 1), 0);
    // "…xW" is 5 wide, "…WxW" 8.
    expect(frontCut('WWWxW', 5, wide)).toBe(3);
  });
});

describe('dropLeading', () => {
  it('cuts across runs, leading with the ellipsis', () => {
    expect(
      dropLeading(
        [
          { key: 'repo', text: 'n10/', className: 'muted' },
          { key: 'label', text: 'feature' },
        ],
        2
      )
    ).toEqual([
      { key: 'ellipsis', text: ELLIPSIS },
      { key: 'repo', text: '0/', className: 'muted' },
      { key: 'label', text: 'feature' },
    ]);
  });

  it('drops a run it cuts through entirely', () => {
    expect(
      dropLeading(
        [
          { key: 'repo', text: 'n10/', className: 'muted' },
          { key: 'label', text: 'main' },
        ],
        5
      )
    ).toEqual([
      { key: 'ellipsis', text: ELLIPSIS },
      { key: 'label', text: 'ain' },
    ]);
  });

  it('leaves the runs alone with nothing to cut', () => {
    const parts = [{ key: 'label', text: 'main' }];
    expect(dropLeading(parts, 0)).toBe(parts);
  });
});
