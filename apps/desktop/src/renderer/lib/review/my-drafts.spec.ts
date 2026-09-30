import { describe, expect, it } from 'vitest';
import {
  countByFile,
  inlineTargets,
  unstored,
  type InlineTarget,
} from './my-drafts.js';

const target = (key: string, path = 'a.ts'): InlineTarget => ({
  kind: 'inline',
  key,
  anchor: { path, previousPath: null, range: null, head: null, lines: [] },
});

describe('the reviewer’s comments on code', () => {
  it('lets the stored draft stand for a composer with the same key', () => {
    const stored = {
      ...target('k'),
      anchor: { ...target('k').anchor, path: 'b.ts' },
    };
    expect(inlineTargets([stored], [target('k'), target('n')])).toEqual([
      stored,
      target('n'),
    ]);
  });

  it('forgets a closed composer once its draft is stored, and only then', () => {
    const fresh = [target('k'), target('n')];
    const none = new Set<string>();
    expect(unstored(fresh, [target('k')], none)).toEqual([target('n')]);
    expect(unstored(fresh, [target('x')], none)).toBe(fresh);
  });

  it('keeps an open composer, so emptying its stored draft cannot close it', () => {
    const fresh = [target('k')];
    expect(unstored(fresh, [target('k')], new Set(['k']))).toBe(fresh);
  });

  it('counts drafts per file', () => {
    expect(
      countByFile([target('a'), target('b'), target('c', 'b.ts')])
    ).toEqual(
      new Map([
        ['a.ts', 2],
        ['b.ts', 1],
      ])
    );
  });
});
