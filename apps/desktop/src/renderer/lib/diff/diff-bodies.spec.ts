import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParsedDiffFile } from '@n10/diff';
import type { PrDiffManifestFile } from '../../../host/contract.js';
import {
  aloneBatch,
  bodyOf,
  isImagePath,
  LARGE_FILE_BYTES,
  mispaired,
  planBatches,
  showsImages,
  type BatchRead,
} from './diff-bodies.js';

/**
 * Batching decides what a reader can see of a big pull request: a file
 * no batch holds is never read, and a batch that grows without bound is
 * the whole-patch ceiling again under another name.
 */

function manifestFile(
  path: string,
  patch: Partial<PrDiffManifestFile> = {}
): PrDiffManifestFile {
  return {
    path,
    oldPath: path,
    status: 'modified',
    similarity: null,
    oldMode: '100644',
    newMode: '100644',
    oldOid: 'a'.repeat(40),
    newOid: 'b'.repeat(40),
    kind: 'text',
    additions: 1,
    deletions: 1,
    oldSize: 100,
    newSize: 100,
    ...patch,
  };
}

const LIMITS = { bytes: 1000, files: 3 };

describe('planBatches', () => {
  it('keeps manifest order and splits at the file limit', () => {
    const files = ['a', 'b', 'c', 'd'].map((p) => manifestFile(p));
    expect(planBatches(files, LIMITS).map((b) => b.files)).toEqual([
      ['a', 'b', 'c'],
      ['d'],
    ]);
  });

  it('splits at the byte limit, by each file’s larger side', () => {
    const files = [
      manifestFile('a', { oldSize: 10, newSize: 600 }),
      manifestFile('b', { oldSize: 500, newSize: 10 }),
    ];
    expect(planBatches(files, LIMITS).map((b) => b.files)).toEqual([
      ['a'],
      ['b'],
    ]);
  });

  it('asks git for both paths of a rename', () => {
    const [batch] = planBatches([
      manifestFile('new.ts', { oldPath: 'old.ts', status: 'renamed' }),
    ]);
    expect(batch!.pathspec).toEqual(['old.ts', 'new.ts']);
  });

  it('reads nothing for binary content or a change without lines', () => {
    const files = [
      manifestFile('img.png', { kind: 'binary', additions: null }),
      manifestFile('moved.ts', { additions: 0, deletions: 0 }),
      manifestFile('mode.sh', { additions: 0, deletions: 0 }),
    ];
    expect(planBatches(files)).toEqual([]);
  });

  it('leaves a large file out, to be read when asked', () => {
    const files = [
      manifestFile('small.ts'),
      manifestFile('huge.json', { newSize: LARGE_FILE_BYTES + 1 }),
    ];
    expect(planBatches(files).flatMap((b) => b.files)).toEqual(['small.ts']);
    expect(aloneBatch(files[1]!, 'changes')).toMatchObject({
      id: 'alone:changes:huge.json',
      files: ['huge.json'],
    });
  });

  it('reads a file whose counts never arrived', () => {
    // A listing cut before its numstat section: not "no changes".
    const files = [manifestFile('x', { additions: null, deletions: null })];
    expect(planBatches(files).flatMap((b) => b.files)).toEqual(['x']);
  });

  it('never reads a deleted file beside an added one', () => {
    // Read together, git could pair them into a rename the manifest,
    // past diff.renameLimit, left as a delete and an add.
    const files = [
      manifestFile('a-old.txt', { status: 'deleted' }),
      manifestFile('b-new.txt', { status: 'added' }),
      manifestFile('c.txt'),
      manifestFile('d-old.txt', { status: 'deleted' }),
    ];
    expect(planBatches(files).map((b) => b.files)).toEqual([
      ['a-old.txt', 'd-old.txt'],
      ['b-new.txt', 'c.txt'],
    ]);
  });

  it('reads renamed files apart from the rest, which then name no source', () => {
    const files = [
      manifestFile('a.txt', { status: 'added' }),
      manifestFile('new.txt', { status: 'renamed', oldPath: 'old.txt' }),
      manifestFile('m.txt'),
    ];
    expect(planBatches(files).map((b) => b.pathspec)).toEqual([
      ['a.txt', 'm.txt'],
      ['old.txt', 'new.txt'],
    ]);
  });

  it('names the files a read paired otherwise than the manifest', () => {
    const [batch] = planBatches([
      manifestFile('a.txt', { status: 'added' }),
      manifestFile('m.txt'),
    ]);
    const read = new Map([
      // Paired with a source the manifest did not give it.
      ['a.txt', { oldPath: 'old.txt', status: 'renamed' as const }],
      ['m.txt', { oldPath: 'm.txt', status: 'modified' as const }],
    ]);
    expect(mispaired(batch!, read)).toEqual(['a.txt']);
  });

  it('puts every readable file in exactly one batch, within the limits', () => {
    const file = fc.record({
      size: fc.nat({ max: 1500 }),
      adds: fc.nat({ max: 3 }),
      binary: fc.boolean(),
      status: fc.constantFrom('added', 'deleted', 'modified', 'renamed'),
    });
    fc.assert(
      fc.property(fc.array(file, { maxLength: 40 }), (specs) => {
        const files = specs.map((s, i) =>
          manifestFile(`f${String(i).padStart(2, '0')}`, {
            newSize: s.size,
            oldSize: 0,
            additions: s.adds,
            deletions: 0,
            kind: s.binary ? 'binary' : 'text',
            status: s.status,
          })
        );
        const batches = planBatches(files, LIMITS);
        const placed = batches.flatMap((b) => b.files);
        const readable = files
          .filter((f) => f.kind !== 'binary' && f.additions !== 0)
          .map((f) => f.path);
        expect([...placed].sort()).toEqual(readable);
        expect(batches.every((b) => b.files.length <= LIMITS.files)).toBe(true);
        // Only a lone file may exceed the byte limit.
        expect(
          batches.every((b) => b.files.length === 1 || b.bytes <= LIMITS.bytes)
        ).toBe(true);
        expect(new Set(batches.map((b) => b.id)).size).toBe(batches.length);
        const status = new Map(files.map((f) => [f.path, f.status]));
        const lane = (s: string | undefined) =>
          s === 'deleted' || s === 'renamed' ? s : 'rest';
        for (const b of batches) {
          const lanes = new Set(b.files.map((f) => lane(status.get(f))));
          expect(lanes.size).toBe(1);
          // Manifest order within a batch.
          expect(b.files).toEqual([...b.files].sort());
        }
      })
    );
  });
});

describe('bodyOf', () => {
  const parsed = (path: string): ParsedDiffFile => ({
    path,
    oldPath: path,
    status: 'modified',
    binary: false,
    lines: [{ type: 'add', content: 'x', newLine: 1 }],
  });
  const success = (
    files: ParsedDiffFile[],
    truncated = false,
    alone = false
  ): BatchRead => ({
    status: 'success',
    files: new Map(files.map((f) => [f.path, f])),
    truncated,
    limitBytes: 64,
    scope: 'whole-file',
    alone,
  });

  it('is loaded once its batch has the file', () => {
    expect(bodyOf(manifestFile('a'), success([parsed('a')]))).toMatchObject({
      state: 'loaded',
      scope: 'whole-file',
    });
  });

  it('is loading until then', () => {
    expect(bodyOf(manifestFile('a'), { status: 'idle' })).toEqual({
      state: 'loading',
    });
  });

  it('carries the batch’s error', () => {
    expect(
      bodyOf(manifestFile('a'), { status: 'error', message: 'boom' })
    ).toEqual({ state: 'error', message: 'boom' });
  });

  it('says a file read alone past the ceiling is too large', () => {
    expect(bodyOf(manifestFile('b'), success([], true, true))).toEqual({
      state: 'too-large',
      limitBytes: 64,
      scope: 'whole-file',
    });
  });

  it('does not call a file cut from a shared read too large', () => {
    // Nobody knows its size alone: offer to read it by itself.
    expect(bodyOf(manifestFile('b'), success([parsed('a')], true))).toEqual({
      state: 'error',
      message: 'the read of the files around it stopped before this one',
      cut: true,
    });
  });

  it('is an error when git returned no patch for a file it listed', () => {
    expect(bodyOf(manifestFile('b'), success([parsed('a')]))).toMatchObject({
      state: 'error',
    });
  });

  it('is large, with its size, while no read holds it', () => {
    const huge = manifestFile('h', { newSize: LARGE_FILE_BYTES + 5 });
    expect(bodyOf(huge, null)).toEqual({
      state: 'large',
      bytes: LARGE_FILE_BYTES + 5,
    });
  });

  it('names why a file has no lines', () => {
    expect(
      bodyOf(manifestFile('m', { additions: 0, deletions: 0 }), null)
    ).toEqual({ state: 'no-text', reason: 'no-content-changes' });
    expect(
      bodyOf(manifestFile('i', { kind: 'binary', additions: null }), null)
    ).toEqual({ state: 'no-text', reason: 'binary' });
  });
});

describe('images', () => {
  it.each([
    ['logo.png', true],
    ['assets/Photo.JPEG', true],
    ['a/b.c/icon.ico', true],
    ['anim.gif', true],
    ['x.webp', true],
    ['x.bmp', true],
    ['drawing.svg', false],
    ['.png', false],
    ['dir.png/file', false],
    ['png', false],
  ])('%s is an image path: %s', (path, image) => {
    expect(isImagePath(path)).toBe(image);
  });

  it('shows a binary file with an image name, by either of its paths', () => {
    expect(showsImages(manifestFile('a.png', { kind: 'binary' }))).toBe(true);
    expect(
      showsImages(
        manifestFile('a.dat', {
          kind: 'binary',
          oldPath: 'a.png',
          status: 'renamed',
        })
      )
    ).toBe(true);
    expect(showsImages(manifestFile('a.bin', { kind: 'binary' }))).toBe(false);
    // Text git can diff keeps its lines, whatever it is called.
    expect(showsImages(manifestFile('a.png'))).toBe(false);
  });
});
