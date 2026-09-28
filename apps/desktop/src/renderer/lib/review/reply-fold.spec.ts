import { describe, expect, it } from 'vitest';
import { foldReplies } from './reply-fold.js';

describe('foldReplies', () => {
  it('shows a short thread whole', () => {
    expect(foldReplies(4, new Set())).toHaveLength(4);
  });

  it('keeps the first reply and the last two, and folds the rest', () => {
    expect(foldReplies(9, new Set())).toEqual([
      { kind: 'reply', index: 0 },
      { kind: 'gap', from: 1, count: 6 },
      { kind: 'reply', index: 7 },
      { kind: 'reply', index: 8 },
    ]);
  });

  it('shows a match deep in the thread, folding either side of it', () => {
    expect(foldReplies(125, new Set([119]))).toEqual([
      { kind: 'reply', index: 0 },
      { kind: 'gap', from: 1, count: 118 },
      { kind: 'reply', index: 119 },
      { kind: 'gap', from: 120, count: 3 },
      { kind: 'reply', index: 123 },
      { kind: 'reply', index: 124 },
    ]);
  });
});
