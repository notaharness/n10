import { describe, expect, it } from 'vitest';
import { diffSections, sectionIndex } from './single-file.js';

const FILES = [
  ['a.ts', []],
  ['b.ts', []],
  ['c.ts', []],
] as const;

describe('single-file sections', () => {
  it('pages through the conversation first, then each file in order', () => {
    expect(diffSections(FILES, true)).toEqual([
      { kind: 'conversation' },
      { kind: 'file', path: 'a.ts' },
      { kind: 'file', path: 'b.ts' },
      { kind: 'file', path: 'c.ts' },
    ]);
    expect(diffSections(FILES, false)).toHaveLength(3);
  });

  it('shows the file the reader went to', () => {
    const sections = diffSections(FILES, true);
    expect(sectionIndex(sections, { file: 'b.ts', conversation: false })).toBe(
      2
    );
  });

  it('shows the conversation after a jump to a general comment', () => {
    const sections = diffSections(FILES, true);
    expect(sectionIndex(sections, { file: 'b.ts', conversation: true })).toBe(
      0
    );
  });

  it('starts at the first file, not the conversation', () => {
    const sections = diffSections(FILES, true);
    expect(sectionIndex(sections, { file: null, conversation: false })).toBe(1);
  });

  it('falls back to the first file when the reader’s file is gone', () => {
    const sections = diffSections(FILES, false);
    expect(
      sectionIndex(sections, { file: 'gone.ts', conversation: false })
    ).toBe(0);
  });

  it('shows the conversation when it is all there is, and nothing when empty', () => {
    expect(
      sectionIndex(diffSections([], true), { file: null, conversation: false })
    ).toBe(0);
    expect(
      sectionIndex(diffSections([], false), { file: null, conversation: false })
    ).toBe(-1);
  });
});
