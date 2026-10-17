import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '@n10/diff';
import {
  anchorOutsideDiff,
  commentableRanges,
  readAnchor,
} from './comment-anchor.js';

describe('readAnchor', () => {
  it('reads no file as the pull request', () => {
    expect(readAnchor({})).toEqual({
      ok: true,
      anchor: { file: null, lineStart: null, lineEnd: null, side: 'RIGHT' },
    });
  });

  it('reads a file alone as the whole file', () => {
    expect(readAnchor({ file: 'a.ts' })).toMatchObject({
      ok: true,
      anchor: { file: 'a.ts', lineStart: null, lineEnd: null },
    });
  });

  it('reads lines on the side named', () => {
    expect(
      readAnchor({ file: 'a.ts', lineStart: '3', lineEnd: '5', side: 'LEFT' })
    ).toMatchObject({
      ok: true,
      anchor: { file: 'a.ts', lineStart: 3, lineEnd: 5, side: 'LEFT' },
    });
  });

  it.each([
    [{ lineStart: '3' }, '--lineStart, --lineEnd and --side need --file'],
    [{ file: 'a.ts', lineEnd: '3' }, '--lineEnd needs --lineStart'],
    [{ file: 'a.ts', side: 'LEFT' }, '--side needs --lineStart'],
    [
      { file: 'a.ts', lineStart: '3', side: 'UP' },
      'Invalid side. Must be LEFT or RIGHT',
    ],
    [
      { file: 'a.ts', lineStart: '0' },
      '--lineStart and --lineEnd must be line numbers from 1',
    ],
    [
      { file: 'a.ts', lineStart: '2.5' },
      '--lineStart and --lineEnd must be line numbers from 1',
    ],
    [
      { file: 'a.ts', lineStart: '5', lineEnd: '3' },
      '--lineStart must not be after --lineEnd',
    ],
  ])('refuses %o', (parsed, error) => {
    expect(readAnchor(parsed)).toEqual({ ok: false, error });
  });
});

const PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,4 +1,4 @@
 one
-two
+TWO
 three
 four
@@ -20,3 +20,4 @@
 twenty
+new
 twenty-one
 twenty-two
`;
const lines = parseUnifiedDiff(PATCH).get('a.ts') ?? [];

describe('commentableRanges', () => {
  it('lists each hunk on the new side, context included', () => {
    expect(commentableRanges(lines, 'RIGHT')).toEqual([
      [1, 4],
      [20, 23],
    ]);
  });

  it('lists each hunk on the old side', () => {
    expect(commentableRanges(lines, 'LEFT')).toEqual([
      [1, 4],
      [20, 22],
    ]);
  });

  it('keeps hunks that meet apart: a comment cannot span the gap', () => {
    const touching = parseUnifiedDiff(
      PATCH.replace('@@ -20,3 +20,4 @@', '@@ -5,3 +5,4 @@')
    ).get('a.ts');
    expect(commentableRanges(touching ?? [], 'RIGHT')).toEqual([
      [1, 4],
      [5, 8],
    ]);
  });
});

describe('anchorOutsideDiff', () => {
  const at = 'the diff';
  const anchor = (lineStart: number | null, lineEnd = lineStart) => ({
    file: 'a.ts',
    lineStart,
    lineEnd,
    side: 'RIGHT' as const,
  });

  it('accepts lines inside one hunk, and the whole file', () => {
    expect(anchorOutsideDiff(anchor(2, 4), lines, at)).toBeNull();
    expect(anchorOutsideDiff(anchor(21), lines, at)).toBeNull();
    expect(anchorOutsideDiff(anchor(null), lines, at)).toBeNull();
  });

  it('refuses a range across two hunks', () => {
    expect(anchorOutsideDiff(anchor(4, 20), lines, at)).toMatch(
      /^a\.ts lines 4-20 \(RIGHT\) are outside the diff\. Lines in the diff on that side: 1-4, 20-23\./
    );
  });

  it('says when a side has no lines at all', () => {
    const added = parseUnifiedDiff(`diff --git a/n.ts b/n.ts
new file mode 100644
--- /dev/null
+++ b/n.ts
@@ -0,0 +1,2 @@
+one
+two
`).get('n.ts');
    expect(
      anchorOutsideDiff(
        { file: 'n.ts', lineStart: 1, lineEnd: 1, side: 'LEFT' },
        added ?? [],
        at
      )
    ).toContain('The diff has no lines on that side.');
  });

  it('refuses a file the diff does not change, even without lines', () => {
    expect(anchorOutsideDiff(anchor(null), null, at)).toBe(
      'a.ts is not changed in the diff. Comment on a changed file, or leave out --file to comment on the pull request.'
    );
  });
});
