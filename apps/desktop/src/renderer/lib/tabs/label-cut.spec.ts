import { describe, expect, it } from 'vitest';
import { cutToFit, dropChars, ELLIPSIS } from './label-cut.js';

/** One unit per character, the ellipsis included. */
const mono = (s: string) => [...s].length;

describe('cutToFit', () => {
  it('keeps a label that fits', () => {
    expect(cutToFit('feat/tabs', 9, mono, 'start')).toBe(0);
    expect(cutToFit('feat/tabs', 9, mono, 'end')).toBe(0);
  });

  it('drops just enough from the start for the ellipsis and the end', () => {
    const text = 'feature/tab-strip-wrap';
    const cut = cutToFit(text, 10, mono, 'start');
    expect(ELLIPSIS + text.slice(cut)).toBe('…trip-wrap');
  });

  it('drops just enough from the end for the start and the ellipsis', () => {
    const text = 'Handle cancelled requests';
    const cut = cutToFit(text, 10, mono, 'end');
    expect(text.slice(0, text.length - cut) + ELLIPSIS).toBe('Handle ca…');
  });

  it('keeps nothing when not even one character fits', () => {
    expect(cutToFit('abc', 0.5, mono, 'start')).toBe(3);
    expect(cutToFit('abc', 0.5, mono, 'end')).toBe(3);
  });

  it('never splits a character made of two code units', () => {
    expect(cutToFit('ab😀', 2, mono, 'start')).toBe(2);
    expect(cutToFit('😀ab', 2, mono, 'end')).toBe(2);
  });

  it('keeps the most that fits for widths that vary per character', () => {
    const wide = (s: string) =>
      [...s].reduce((w, c) => w + (c === 'W' ? 3 : 1), 0);
    // "…xW" is 5 wide, "…WxW" 8.
    expect(cutToFit('WWWxW', 5, wide, 'start')).toBe(3);
  });
});

describe('dropChars', () => {
  const parts = [
    { key: 'repo', text: 'n10/', className: 'muted' },
    { key: 'label', text: 'feature' },
  ];

  it('cuts across runs from the start, the ellipsis leading', () => {
    expect(dropChars(parts, 2, 'start')).toEqual([
      { key: 'ellipsis', text: ELLIPSIS },
      { key: 'repo', text: '0/', className: 'muted' },
      { key: 'label', text: 'feature' },
    ]);
  });

  it('drops a run it cuts through entirely', () => {
    expect(dropChars(parts, 5, 'start')).toEqual([
      { key: 'ellipsis', text: ELLIPSIS },
      { key: 'label', text: 'eature' },
    ]);
  });

  it('cuts across runs from the end, the ellipsis trailing', () => {
    expect(dropChars(parts, 9, 'end')).toEqual([
      { key: 'repo', text: 'n1', className: 'muted' },
      { key: 'ellipsis', text: ELLIPSIS },
    ]);
  });

  it('leaves no space between the ellipsis and the word beside it', () => {
    const title = [{ key: 'label', text: 'Handle cancelled requests now' }];
    expect(dropChars(title, 3, 'end')).toEqual([
      { key: 'label', text: 'Handle cancelled requests' },
      { key: 'ellipsis', text: ELLIPSIS },
    ]);
    expect(dropChars([{ key: 'label', text: 'a b' }], 1, 'start')).toEqual([
      { key: 'ellipsis', text: ELLIPSIS },
      { key: 'label', text: 'b' },
    ]);
  });

  it('trims the run beside the ellipsis, not the prefix, on an end cut', () => {
    expect(
      dropChars(
        [
          { key: 'repo', text: 'n10/', className: 'muted' },
          { key: 'label', text: 'Handle cancelled requests' },
        ],
        8,
        'end'
      )
    ).toEqual([
      { key: 'repo', text: 'n10/', className: 'muted' },
      { key: 'label', text: 'Handle cancelled' },
      { key: 'ellipsis', text: ELLIPSIS },
    ]);
  });

  it('leaves the runs alone with nothing to cut', () => {
    expect(dropChars(parts, 0, 'end')).toBe(parts);
  });
});
