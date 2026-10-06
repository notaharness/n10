import { describe, expect, it } from 'vitest';
import { textRanges } from './text-matches.js';

describe('textRanges', () => {
  it('keeps offsets in the original text after Unicode lowercase expansion', () => {
    expect(textRanges('İ something SOMETHING', 'something')).toEqual([
      { start: 2, end: 11 },
      { start: 12, end: 21 },
    ]);
    expect(textRanges('İ i̇', 'İ')).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 4 },
    ]);
  });

  it('finds case-insensitive substrings inside identifiers', () => {
    expect(
      textRanges('const something = useSomething();', 'something')
    ).toEqual([
      { start: 6, end: 15 },
      { start: 21, end: 30 },
    ]);
  });
});
