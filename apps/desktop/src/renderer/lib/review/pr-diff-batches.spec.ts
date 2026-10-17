import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrDiffManifestFile } from '../../../host/contract.js';
import { planBatches } from '../diff/diff-bodies.js';
import { batchQuery } from './pr-diff-batches.js';

/**
 * A batch's read is checked against the manifest: a file Git paired
 * otherwise within the batch is read again, alone, by its own paths.
 * The host is a stub that answers with patches as Git prints them.
 */

const OID = { base: 'a'.repeat(40), head: 'b'.repeat(40) };
const comparison = {
  mergeBaseOid: OID.base,
  headOid: OID.head,
  targetOid: OID.base,
  sourceRef: null,
  targetRef: 'main',
  headVerified: true,
  targetVerified: false,
};

function file(path: string, patch: Partial<PrDiffManifestFile> = {}) {
  return {
    path,
    oldPath: path,
    status: 'modified',
    similarity: null,
    oldMode: '100644',
    newMode: '100644',
    oldOid: 'c'.repeat(40),
    newOid: 'd'.repeat(40),
    kind: 'text',
    additions: 1,
    deletions: 1,
    oldSize: 10,
    newSize: 10,
    ...patch,
  } as PrDiffManifestFile;
}

const added = (path: string) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${path}\n`;
const renamed = (from: string, to: string) =>
  `diff --git a/${from} b/${to}\nsimilarity index 80%\nrename from ${from}\nrename to ${to}\n--- a/${from}\n+++ b/${to}\n@@ -1 +1 @@\n-old\n+new\n`;

afterEach(() => vi.unstubAllGlobals());

describe('reading a batch', () => {
  it('reads again alone a file the batch paired otherwise', async () => {
    const reads: string[][] = [];
    const patches: Record<string, string> = {
      // The batch: Git gave the added file the rename's source.
      'a.txt,m.txt': renamed('old.txt', 'a.txt'),
      'a.txt': added('a.txt'),
    };
    vi.stubGlobal('window', {
      n10: {
        fetchPrDiffPatch: ({ paths }: { paths: string[] }) => {
          reads.push(paths);
          return Promise.resolve({
            ok: true,
            patch: {
              text: patches[paths.join(',')] ?? '',
              truncated: false,
              limitBytes: 1,
            },
          });
        },
      },
    });
    const [batch] = planBatches([
      file('a.txt', { status: 'added', oldPath: 'a.txt' }),
      file('m.txt'),
    ]);
    const query = batchQuery('/repo', comparison, batch!, 'whole-file');
    const data = await query.queryFn!({
      signal: new AbortController().signal,
    } as never);
    expect(reads).toEqual([['a.txt', 'm.txt'], ['a.txt']]);
    expect(data.files.get('a.txt')).toMatchObject({
      status: 'added',
      oldPath: 'a.txt',
    });
  });
});
