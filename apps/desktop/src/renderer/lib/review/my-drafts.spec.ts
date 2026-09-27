import { describe, expect, it } from 'vitest';
import { inlineTargets, unstored, type InlineTarget } from './my-drafts.js';

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

  it('forgets a composer once its draft is stored, and only then', () => {
    const fresh = [target('k'), target('n')];
    expect(unstored(fresh, [target('k')])).toEqual([target('n')]);
    expect(unstored(fresh, [target('x')])).toBe(fresh);
  });
});
