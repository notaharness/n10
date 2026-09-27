import { describe, expect, it } from 'vitest';
import { sameItem, type PendingComment } from './pr-review-match.js';

const comment = (over: Partial<PendingComment> = {}): PendingComment => ({
  id: 'C',
  body: 'Why?',
  path: 'a.ts',
  line: 5,
  startLine: 3,
  subjectType: 'LINE',
  replyTo: null,
  ...over,
});

const range = { startSide: 'RIGHT', start: 3, side: 'RIGHT', end: 5 } as const;
const line = {
  body: 'Why?',
  place: { kind: 'line' as const, path: 'a.ts', range },
};

describe('sameItem', () => {
  it('matches a comment by its text and place', () => {
    expect(sameItem(comment(), line)).toBe(true);
    expect(
      sameItem(comment({ line: null, subjectType: 'FILE' }), {
        body: 'Why?',
        place: { kind: 'file', path: 'a.ts' },
      })
    ).toBe(true);
    expect(
      sameItem(
        comment({ replyTo: { id: 'P' } }),
        { body: 'Why?', place: { kind: 'reply', threadId: 'T' } },
        'P'
      )
    ).toBe(true);
  });

  it('tells a reply in one thread from the same reply in another', () => {
    const reply = {
      body: 'Why?',
      place: { kind: 'reply' as const, threadId: 'T' },
    };
    expect(sameItem(comment({ replyTo: { id: 'Q' } }), reply, 'P')).toBe(false);
    expect(sameItem(comment({ replyTo: { id: 'P' } }), reply, null)).toBe(
      false
    );
  });

  it('tells apart the same text on another line, as a file comment or a reply', () => {
    expect(sameItem(comment({ line: 4 }), line)).toBe(false);
    expect(sameItem(comment({ startLine: 4 }), line)).toBe(false);
    expect(sameItem(comment({ startLine: null }), line)).toBe(false);
    expect(sameItem(comment({ subjectType: 'FILE', line: null }), line)).toBe(
      false
    );
    expect(sameItem(comment({ replyTo: { id: 'P' } }), line)).toBe(false);
    expect(sameItem(comment({ path: 'b.ts' }), line)).toBe(false);
    expect(sameItem(comment({ body: 'Why not?' }), line)).toBe(false);
    expect(
      sameItem(comment(), {
        body: 'Why?',
        place: { kind: 'file', path: 'a.ts' },
      })
    ).toBe(false);
  });
});
