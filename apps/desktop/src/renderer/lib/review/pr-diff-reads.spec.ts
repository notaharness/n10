import { describe, expect, it } from 'vitest';
import type { PrDiffManifestFile } from '../../../host/contract.js';
import { LARGE_FILE_BYTES, planBatches } from '../diff/diff-bodies.js';
import {
  bodiesOf,
  forComparison,
  heldReads,
  KEPT_READS,
  NOTHING,
  readIndex,
  withAlone,
  withRequested,
  withShown,
  type Requested,
} from './pr-diff-reads.js';

/**
 * What stays read of a big pull request: without a bound, reading
 * through one keeps every batch — and every parsed line — alive.
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

// One file per batch: 10 batches.
const files = Array.from({ length: 10 }, (_, i) => manifestFile(`f${i}`));
const batches = planBatches(files, { bytes: 1000, files: 1 });
const byPath = new Map(files.map((f) => [f.path, f]));
const index = readIndex(batches, byPath, new Map());
const held = (r: Requested) =>
  heldReads(r, readIndex(batches, byPath, r.alone)).map((p) => p.batch.files);

describe('which reads are held', () => {
  it('holds the first batch before anything is asked for', () => {
    expect(held(NOTHING)).toEqual([['f0']]);
  });

  it('holds what the list shows, and lets go of what it no longer shows past the recent few', () => {
    let r = NOTHING;
    for (let i = 1; i <= 8; i++) r = withShown(r, [`f${i}`], index);
    expect(held(r)).toEqual([['f0'], ['f8'], ['f7'], ['f6'], ['f5'], ['f4']]);
    expect(r.recent).toHaveLength(KEPT_READS);
  });

  it('keeps everything on screen, however many batches that is', () => {
    const shown = files.slice(1).map((f) => f.path);
    const r = withShown(NOTHING, shown, index);
    expect(held(r)).toHaveLength(10);
  });

  it('is the same state when the list shows the same reads', () => {
    const r = withShown(NOTHING, ['f3'], index);
    expect(withShown(r, ['f3'], index)).toBe(r);
    const asked = withRequested(r, ['f3'], index);
    expect(withRequested(asked, ['f3'], index)).toBe(asked);
  });

  it('never lets reads that stay on screen push out one asked for elsewhere', () => {
    // The walkthrough asks for f9 while the list behind it shows five
    // batches, and remeasures them.
    let r = withRequested(NOTHING, ['f9'], index);
    const onScreen = ['f1', 'f2', 'f3', 'f4', 'f5'];
    r = withShown(r, onScreen, index);
    r = withShown(r, onScreen.slice(1), index);
    r = withShown(r, onScreen, index);
    expect(held(r)).toContainEqual(['f9']);
  });

  it('holds what was asked for elsewhere, beside what is shown', () => {
    const r = withRequested(withShown(NOTHING, ['f2'], index), ['f9'], index);
    expect(held(r)).toEqual([['f0'], ['f2'], ['f9']]);
  });

  it('starts over for another comparison', () => {
    const r = { ...withShown(NOTHING, ['f5'], index), key: 'a..b' };
    expect(forComparison(r, 'a..b')).toBe(r);
    expect(forComparison(r, 'a..c')).toEqual({ ...NOTHING, key: 'a..c' });
  });
});

describe('bodies from the reads held', () => {
  it('shows a file whose read is not held as loading, to be read when reached', () => {
    const { bodies } = bodiesOf(files, index, new Map());
    expect(bodies.get('f4')).toEqual({ state: 'loading' });
  });

  it('reads a file alone in place of its batch', () => {
    const big = manifestFile('big', { newSize: LARGE_FILE_BYTES + 1 });
    const all = [...files, big];
    const paths = new Map(all.map((f) => [f.path, f]));
    const r = withAlone(NOTHING, big, 'changes');
    const alone = readIndex(planBatches(all), paths, r.alone);
    expect(alone.idOf.get('big')).toBe('alone:changes:big');
    expect(heldReads(r, alone).map((p) => p.batch.id)).toContain(
      'alone:changes:big'
    );
    // Not asked for, a large file has no read at all.
    const none = readIndex(planBatches(all), paths, new Map());
    expect(bodiesOf(all, none, new Map()).bodies.get('big')).toMatchObject({
      state: 'large',
    });
  });
});
