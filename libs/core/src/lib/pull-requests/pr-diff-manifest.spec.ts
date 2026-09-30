import { describe, expect, it } from 'vitest';
import { parseManifestListing } from './pr-diff-manifest.js';

/**
 * `git diff -z --raw --numstat` as text. The git-backed cases are in
 * pr-diff-manifest.integration.spec.ts; these pin the record format,
 * and what happens when the ceiling cuts a listing mid-record.
 */

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const Z = '0'.repeat(40);

const LISTING = [
  `:100644 100644 ${A} ${B} M`,
  'src/a.ts',
  `:100644 100644 ${A} ${A} R100`,
  'old name.ts',
  'new name.ts',
  `:000000 100644 ${Z} ${B} A`,
  'img.png',
  '3\t1\tsrc/a.ts',
  '0\t0\t',
  'old name.ts',
  'new name.ts',
  '-\t-\timg.png',
  '',
].join('\0');

describe('parseManifestListing', () => {
  it('pairs each raw record with its counts, in order', () => {
    expect(parseManifestListing(LISTING)).toEqual([
      {
        path: 'src/a.ts',
        oldPath: 'src/a.ts',
        status: 'modified',
        similarity: null,
        oldMode: '100644',
        newMode: '100644',
        oldOid: A,
        newOid: B,
        kind: 'text',
        additions: 3,
        deletions: 1,
      },
      expect.objectContaining({
        path: 'new name.ts',
        oldPath: 'old name.ts',
        status: 'renamed',
        similarity: 100,
        additions: 0,
        deletions: 0,
      }),
      expect.objectContaining({
        path: 'img.png',
        status: 'added',
        oldMode: null,
        oldOid: null,
        kind: 'binary',
        additions: null,
        deletions: null,
      }),
    ]);
  });

  it('keeps whole records of a cut listing and drops the partial one', () => {
    // Cut inside the rename's second path: its record is incomplete.
    const cut = LISTING.slice(0, LISTING.indexOf('new name.ts') + 3);
    const files = parseManifestListing(cut);
    expect(files.map((f) => f.path)).toEqual(['src/a.ts']);
    // Its counts never arrived: unknown, not zero, and not binary.
    expect(files[0]).toMatchObject({
      additions: null,
      deletions: null,
      kind: 'text',
    });
  });

  it('reads nothing from an empty listing', () => {
    expect(parseManifestListing('')).toEqual([]);
  });
});
