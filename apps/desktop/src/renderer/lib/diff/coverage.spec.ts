import { describe, expect, it } from 'vitest';
import type { PrDiffManifestFile } from '../../../host/contract.js';
import { coverageOf } from './coverage.js';
import type { FileBody } from './diff-bodies.js';

const file = (path: string, newSize = 10): PrDiffManifestFile => ({
  path,
  oldPath: path,
  status: 'modified',
  similarity: null,
  oldMode: '100644',
  newMode: '100644',
  oldOid: null,
  newOid: null,
  kind: 'text',
  additions: 1,
  deletions: 1,
  oldSize: 0,
  newSize,
});

describe('coverageOf', () => {
  it('counts the files the diff cannot show, by reason, with the first of each', () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f'].map((p, i) => file(p, i + 1));
    const bodies = new Map<string, FileBody>([
      ['a', { state: 'loaded', lines: [], scope: 'whole-file' }],
      ['b', { state: 'large', bytes: 2 }],
      ['c', { state: 'error', message: 'boom' }],
      ['d', { state: 'large', bytes: 4 }],
      ['e', { state: 'no-text', reason: 'binary' }],
      // Not reached yet: shown when it is, so not "not shown".
      ['f', { state: 'loading' }],
    ]);
    expect(coverageOf(files, bodies)).toEqual({
      textFiles: 5,
      unavailable: {
        large: { count: 2, first: 'b', bytes: 6 },
        error: { count: 1, first: 'c', bytes: 3 },
      },
    });
  });
});
