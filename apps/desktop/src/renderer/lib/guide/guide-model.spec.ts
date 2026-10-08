import { describe, expect, it } from 'vitest';
import type { GuidedReview } from '../../../host/contract.js';
import {
  clampStep,
  codeFence,
  fileLabel,
  isGuideStale,
  slideLayout,
  stepLabels,
} from './guide-model.js';

const GUIDE: GuidedReview = {
  prId: 1,
  createdAt: '',
  commit: 'abc',
  title: 'T',
  summary: 'S',
  slides: [{ title: 'Same' }, { title: 'Same' }],
};

describe('slideLayout', () => {
  it('lays a slide out by what it has', () => {
    const diagram = { mermaid: 'flowchart LR\n a' };
    expect(slideLayout({ title: 'a' })).toBe('text');
    expect(slideLayout({ title: 'a', visual: diagram })).toBe('split');
    expect(slideLayout({ title: 'a', before: diagram, after: diagram })).toBe(
      'compare'
    );
  });
});

describe('steps', () => {
  /** Labels are the dots' keys and names: two slides of one title
   *  must still be two steps. */
  it('names the cover and numbers every slide', () => {
    expect(stepLabels(GUIDE)).toEqual([
      'Cover',
      'Slide 1: Same',
      'Slide 2: Same',
    ]);
  });

  /** A remembered step outlives a guide the agent rewrote shorter. */
  it('keeps a remembered step within the guide', () => {
    expect(clampStep(5, GUIDE)).toBe(2);
    expect(clampStep(-1, GUIDE)).toBe(0);
  });
});

describe('isGuideStale', () => {
  it('is stale only when both commits are known and differ', () => {
    expect(isGuideStale(GUIDE, 'def')).toBe(true);
    expect(isGuideStale(GUIDE, 'abc')).toBe(false);
    expect(isGuideStale(GUIDE, undefined)).toBe(false);
    expect(isGuideStale({ ...GUIDE, commit: undefined }, 'def')).toBe(false);
  });
});

describe('codeFence', () => {
  /** The agent's code cannot close the fence it is shown in. */
  it('fences code with more backticks than it holds', () => {
    expect(codeFence({ code: 'a ```` b', language: 'md' })).toBe(
      '`````md\na ```` b\n`````'
    );
    expect(codeFence({ code: 'x' })).toBe('```\nx\n```');
  });
});

describe('fileLabel', () => {
  it('splits the path and names the lines', () => {
    expect(fileLabel({ path: 'src/a/b.ts', lineStart: 3, lineEnd: 9 })).toEqual(
      { dir: 'src/a/', name: 'b.ts', lines: '3–9' }
    );
    expect(fileLabel({ path: 'b.ts', lineStart: 3, lineEnd: 3 })).toEqual({
      dir: '',
      name: 'b.ts',
      lines: '3',
    });
    expect(fileLabel({ path: 'b.ts' }).lines).toBeNull();
  });
});
