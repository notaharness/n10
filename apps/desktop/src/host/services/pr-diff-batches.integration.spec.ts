import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readPrDiffManifest, readPrDiffPatch } from '@n10/core';
import type { PrDiffManifest } from '../contract.js';
import { planBatches } from '../../renderer/lib/diff/diff-bodies.js';
import { batchQuery } from '../../renderer/lib/review/pr-diff-batches.js';

/**
 * The renderer's batches read against real Git: every file of every
 * batch must come back as the manifest listed it. Git pairs renames
 * among the paths a read names, keeping only a few candidate sources
 * for each file, so a batch can pair differently than the whole pull
 * request did. The fixture is one where it would: an added file close
 * to a rename's source, and closer still to four others that moved in
 * a later batch.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(dir: string, path: string, text: string) {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), text);
}

const lines = (n: number, text: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => `${text(i + 1)}\n`).join('');
const shared = lines(
  14,
  (i) => `shared line ${i} with some padding text to make it long`
);
const xblock = lines(
  5,
  (i) => `x block line ${i} with some padding text to make it long`
);
const old1 = lines(6, (i) => `old1 unique line ${i} with some padding text`);

describe('batches of a pull request that moves near-identical files', () => {
  let repo: string;
  let manifest: PrDiffManifest;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), 'n10-pr-batches-'));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@n10.dev');
    git(repo, 'config', 'user.name', 'n10 Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    write(repo, 'a/old1.txt', shared + old1);
    for (let k = 1; k <= 4; k++) {
      write(
        repo,
        `z/x${k}.txt`,
        `${shared}${xblock}unique to x${k} with padding padding padding\n`
      );
    }
    for (let f = 0; f < 150; f++)
      write(repo, `m/f${String(f).padStart(3, '0')}.txt`, `filler ${f}\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'base');
    const base = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'mv', 'a/old1.txt', 'a/new1.txt');
    const head6 = shared.split('\n').slice(0, 6).join('\n') + '\n';
    write(
      repo,
      'a/new1.txt',
      head6 +
        old1 +
        lines(8, (i) => `brand new line ${i} in new1 with padding text`)
    );
    for (let k = 1; k <= 4; k++) {
      git(repo, 'mv', `z/x${k}.txt`, `z/y${k}.txt`);
      write(
        repo,
        `z/y${k}.txt`,
        `${shared}${xblock}unique to x${k} with padding padding padding\nappended to y${k} with padding padding\n`
      );
    }
    write(repo, 'a/A.txt', shared + xblock);
    for (let f = 0; f < 150; f++)
      write(
        repo,
        `m/f${String(f).padStart(3, '0')}.txt`,
        `filler ${f} edited\n`
      );
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'head');
    const head = git(repo, 'rev-parse', 'HEAD');
    manifest = await readPrDiffManifest(repo, {
      mergeBaseOid: base,
      headOid: head,
      targetOid: base,
      sourceRef: null,
      targetRef: 'main',
      headVerified: true,
      targetVerified: false,
    });
    vi.stubGlobal('window', {
      n10: {
        fetchPrDiffPatch: async (req: {
          mergeBaseOid: string;
          headOid: string;
          paths: string[];
        }) => ({
          ok: true,
          patch: await readPrDiffPatch(repo, req, { paths: req.paths }),
        }),
      },
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    rmSync(repo, { recursive: true, force: true });
  });

  it('lists the rename and the added file as Git does across the whole of it', () => {
    const byPath = new Map(manifest.files.map((f) => [f.path, f]));
    expect(byPath.get('a/new1.txt')).toMatchObject({
      status: 'renamed',
      oldPath: 'a/old1.txt',
    });
    expect(byPath.get('a/A.txt')).toMatchObject({ status: 'added' });
  });

  it('reads every file of every batch as the manifest lists it', async () => {
    const read: [string, string?, string?][] = [];
    for (const batch of planBatches(manifest.files)) {
      const query = batchQuery(repo, manifest.comparison, batch, 'whole-file');
      const data = await query.queryFn!({
        signal: new AbortController().signal,
      } as never);
      for (const path of batch.files) {
        const file = data.files.get(path);
        read.push([path, file?.status, file?.oldPath]);
      }
    }
    const listed = new Map(
      manifest.files.map((f) => [f.path, [f.path, f.status, f.oldPath]])
    );
    expect(read).toEqual(read.map(([path]) => listed.get(path)));
  });
});
