import { describe, expect, it } from 'vitest';
import type { DiffLine } from '@n10/diff';
import type { RemoteCommentThread } from '../../../host/contract.js';
import type { InlineTarget } from '../review/my-drafts.js';
import { IMAGE_ROW_HEIGHT, type FileBody } from './diff-bodies.js';
import { filesOnScreen, noticeRow, type FileStats } from './diff-rows-model.js';
import { buildFlatDiff, type FlatRow } from './diff-virtual.js';

/**
 * A pull request's file whose body is not read — or never will be —
 * still has its place in the list: a header with Git's counts, a notice
 * standing in for its lines, and every comment on it reachable.
 */

const LINES: DiffLine[] = [
  { type: 'hunk-header', content: '@@ -1,1 +1,2 @@' },
  { type: 'context', content: 'kept', oldLine: 1, newLine: 1 },
  { type: 'add', content: 'added', newLine: 2 },
];

function thread(id: string, line: number): RemoteCommentThread {
  return {
    id,
    file: 'a.ts',
    lineStart: line,
    lineEnd: line,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [],
  } as unknown as RemoteCommentThread;
}

/** The reviewer's own draft, on line `end` or (null) on the file. */
function mine(key: string, end: number | null): InlineTarget {
  return {
    kind: 'inline',
    key,
    anchor: {
      path: 'a.ts',
      previousPath: null,
      range: end
        ? { startSide: 'RIGHT', start: end, side: 'RIGHT', end }
        : null,
      head: null,
      lines: [],
    },
  };
}

function build(
  body: FileBody,
  lines: DiffLine[] = [],
  counts: ReadonlyMap<
    string,
    { additions: number; deletions: number }
  > = new Map([['a.ts', { additions: 40, deletions: 10 }]]),
  own: InlineTarget[] = []
) {
  return buildFlatDiff([['a.ts', lines]], {
    view: 'unified',
    hideResolved: false,
    hasConversation: false,
    generalThreads: [],
    threadsByFile: new Map([['a.ts', [thread('T1', 2)]]]),
    draftsByFile: new Map(),
    fileState: new Map(),
    bodies: new Map([['a.ts', body]]),
    counts,
    mineByFile: new Map([['a.ts', own]]),
  });
}

const kinds = (rows: readonly { kind: string }[]) => rows.map((r) => r.kind);

describe('buildFlatDiff with file bodies', () => {
  it('stands a notice in for a file still loading, and jumps to it', () => {
    const flat = build({ state: 'loading' });
    // Its comment is not shown here only to move when the lines land;
    // a jump to it lands on the file meanwhile.
    expect(kinds(flat.rows)).toEqual(['file-header', 'file-notice']);
    expect(flat.indexById.get('T1')).toBe(1);
  });

  it('keeps the comments of a file with no lines under its notice', () => {
    const flat = build({ state: 'large', bytes: 3 << 20 });
    expect(kinds(flat.rows)).toEqual(['file-header', 'file-notice', 'orphans']);
    expect(flat.indexById.get('T1')).toBe(2);
  });

  it("takes the reviewer's line drafts with a file's comments", () => {
    const own = [mine('L', 2), mine('F', null)];
    // A file draft stays under the header either way.
    const loading = build({ state: 'loading' }, [], undefined, own);
    expect(kinds(loading.rows)).toEqual([
      'file-header',
      'file-drafts',
      'file-notice',
    ]);
    expect(loading.indexById.get('L')).toBe(2);
    expect(loading.indexById.get('F')).toBe(1);
    const large = build({ state: 'large', bytes: 3 << 20 }, [], undefined, own);
    const orphans = large.rows[3];
    expect(orphans).toMatchObject({ kind: 'orphans', mine: [own[0]] });
    expect(large.indexById.get('L')).toBe(3);
  });

  it('counts a file from the manifest before its lines arrive', () => {
    const stats = build({ state: 'large', bytes: 3 << 20 }).stats.get('a.ts');
    expect(stats).toMatchObject({ adds: 40, dels: 10 });
  });

  it('does not count a file Git never counted until its lines are read', () => {
    // Past a cut listing: zero would say nothing changed in it.
    const unread = build({ state: 'loading' }, [], new Map()).stats.get('a.ts');
    expect(unread).toMatchObject({ adds: null, dels: null });
    const read = build(
      { state: 'loaded', lines: LINES, scope: 'whole-file' },
      LINES,
      new Map()
    ).stats.get('a.ts');
    expect(read).toMatchObject({ adds: 1, dels: 0 });
  });

  it('sizes the notice for the lines it stands in for, within a bound', () => {
    const notice = build({ state: 'loading' }).rows[1];
    expect(notice).toMatchObject({
      kind: 'file-notice',
      estimate: 36 + 50 * 20,
    });
  });

  it('keeps a notice for files that never get lines', () => {
    for (const body of [
      { state: 'no-text', reason: 'binary' },
      { state: 'too-large', limitBytes: 64 << 20, scope: 'whole-file' },
      { state: 'error', message: 'no' },
    ] as FileBody[]) {
      expect(kinds(build(body).rows)).toContain('file-notice');
    }
  });

  it('puts a notice above a large file read by its changes alone', () => {
    const flat = build(
      { state: 'loaded', lines: LINES, scope: 'changes' },
      LINES
    );
    expect(kinds(flat.rows).slice(0, 2)).toEqual([
      'file-header',
      'file-notice',
    ]);
    expect(kinds(flat.rows)).toContain('unified');
    // Its thread anchors to its line again.
    expect(kinds(flat.rows)).not.toContain('orphans');
  });

  it('shows a whole file read in full as lines alone', () => {
    const flat = build(
      { state: 'loaded', lines: LINES, scope: 'whole-file' },
      LINES
    );
    expect(kinds(flat.rows)).not.toContain('file-notice');
  });
});

describe('the files on screen', () => {
  it('reads an open file, and leaves one showing only its header', () => {
    const rows = [
      { key: 'h:lock.json', kind: 'file-header', file: 'lock.json' },
      { key: 'h:a.ts', kind: 'file-header', file: 'a.ts' },
      { key: 'n:a.ts', kind: 'file-notice', file: 'a.ts', estimate: 36 },
    ] as unknown as FlatRow[];
    const { shown, toRead } = filesOnScreen(rows, [0, 1, 2]);
    expect([...shown]).toEqual(['lock.json', 'a.ts']);
    expect([...toRead]).toEqual(['a.ts']);
  });

  it('leaves a collapsed file with a comment on the whole of it unread', () => {
    const rows = [
      { key: 'h:lock.json', kind: 'file-header', file: 'lock.json' },
      { key: 'fd:lock.json', kind: 'file-drafts', file: 'lock.json' },
    ] as unknown as FlatRow[];
    expect([...filesOnScreen(rows, [0, 1]).toRead]).toEqual([]);
  });
});

describe('an image’s notice row', () => {
  const stats = { adds: null, dels: null } as unknown as FileStats;
  const binary: FileBody = { state: 'no-text', reason: 'binary' };

  it('is the height of its frames from the start', () => {
    expect(noticeRow('logo.png', stats, binary)).toMatchObject({
      estimate: IMAGE_ROW_HEIGHT,
    });
  });

  it('is a notice’s height for any other binary file', () => {
    expect(noticeRow('blob.bin', stats, binary)).toMatchObject({
      estimate: 36,
    });
    expect(noticeRow('logo.png', stats, { state: 'loading' })).toMatchObject({
      estimate: 36,
    });
  });
});
