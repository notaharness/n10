import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseDiffFiles } from '@n10/diff';
import { __resetFetchQueueForTests } from '../sync/fetch-queue.js';
import {
  resolvePrComparison,
  type PrComparison,
  type PrComparisonResult,
} from './pr-comparison.js';
import {
  readPrDiffManifest,
  readPrDiffPatch,
  type PrDiffManifestFile,
} from './pr-diff-manifest.js';

/**
 * The comparison and manifest against real git.
 *
 * Two fixtures: a revision sequence (the spec's Q3) played out between
 * an "upstream" repository and a clone of it, so the clone's refs can
 * lag the pull request the way they do after someone pushes; and a
 * branch of special changes (Q7) — renames, copies, modes, symlinks, a
 * submodule, binary content, missing final newlines and paths git has
 * to quote.
 */

// Newer Git refuses an abbreviated option — Git 2.55 fails
// `--no-find-copies`, short for `--no-find-copies-harder` — and this
// knob makes the Git running the tests refuse one too.
beforeAll(() => {
  vi.stubEnv('GIT_TEST_DISALLOW_ABBREVIATED_OPTIONS', 'true');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@n10.dev');
  git(dir, 'config', 'user.name', 'n10 Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

function write(dir: string, path: string, contents: string | Buffer): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), contents);
}

function commit(dir: string, message: string): string {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

const numbered = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

function comparisonOf(result: PrComparisonResult): PrComparison {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.comparison;
}

function byPath(files: PrDiffManifestFile[], path: string) {
  const found = files.find((f) => f.path === path);
  if (!found) throw new Error(`${path} not in manifest`);
  return found;
}

describe('resolvePrComparison and the manifest over a revision sequence', () => {
  let root: string;
  let upstream: string;
  let clone: string;
  const oids: Record<string, string> = {};

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'n10-pr-manifest-'));
    upstream = join(root, 'upstream');
    clone = join(root, 'clone');
    initRepo(upstream);
    write(upstream, 'a.txt', numbered(30));
    write(upstream, 'c.txt', numbered(30));
    oids.B1 = commit(upstream, 'B1');
    git(upstream, 'checkout', '-q', '-b', 'feature');
    write(upstream, 'a.txt', numbered(30).replace('line 5\n', 'five\n'));
    write(upstream, 'b.txt', 'added in H1\n');
    oids.H1 = commit(upstream, 'H1');

    git(root, 'clone', '-q', upstream, clone);
    git(clone, 'config', 'user.email', 'test@n10.dev');
    git(clone, 'config', 'user.name', 'n10 Test');

    // Pushed after the clone last fetched: its origin/feature lags.
    write(
      upstream,
      'a.txt',
      readFileSync(join(upstream, 'a.txt'), 'utf8').replace(
        'line 10\n',
        'ten\n'
      )
    );
    write(upstream, 'new.txt', 'added in H2\n');
    oids.H2 = commit(upstream, 'H2');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('fetches a head the clone does not have yet, and reads exactly it', async () => {
    __resetFetchQueueForTests();
    expect(git(clone, 'rev-parse', 'origin/feature')).toBe(oids.H1);
    const comparison = comparisonOf(
      await resolvePrComparison({
        cwd: clone,
        sourceBranch: 'feature',
        targetBranch: 'main',
        expectedHeadOid: oids.H2,
      })
    );
    expect(comparison).toEqual({
      headOid: oids.H2,
      targetOid: oids.B1,
      mergeBaseOid: oids.B1,
      sourceRef: 'origin/feature',
      targetRef: 'origin/main',
      headVerified: true,
      targetVerified: false,
    });
    const manifest = await readPrDiffManifest(clone, comparison);
    expect(manifest.complete).toBe(true);
    expect(manifest.files.map((f) => [f.path, f.status])).toEqual([
      ['a.txt', 'modified'],
      ['b.txt', 'added'],
      ['new.txt', 'added'],
    ]);
    expect(byPath(manifest.files, 'a.txt')).toMatchObject({
      additions: 2,
      deletions: 2,
      kind: 'text',
    });
  });

  it('says what it has when the head cannot be had, rather than using it', async () => {
    const missing = 'e'.repeat(40);
    const result = await resolvePrComparison({
      cwd: clone,
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedHeadOid: missing,
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'head-unavailable',
        expectedHeadOid: missing,
        localHeadOid: oids.H2,
        message: expect.stringContaining(
          `origin/feature is at ${oids.H2.slice(0, 7)}`
        ),
      }),
    });
  });

  it('does not fetch when asked not to', async () => {
    __resetFetchQueueForTests();
    write(upstream, 'later.txt', 'H2b\n');
    const later = commit(upstream, 'H2b');
    const result = await resolvePrComparison({
      cwd: clone,
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedHeadOid: later,
      fetch: false,
    });
    expect(!result.ok && result.error.code).toBe('head-unavailable');
    git(upstream, 'reset', '-q', '--hard', oids.H2);
  });

  it('fetches again for a push made after its last fetch', async () => {
    // A fetch lands, then the author pushes. The next head must not be
    // answered from that fetch: the commit it names is not in it.
    __resetFetchQueueForTests();
    await resolvePrComparison({
      cwd: clone,
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedHeadOid: 'e'.repeat(40),
    });
    write(upstream, 'pushed-later.txt', 'H2c\n');
    const later = commit(upstream, 'H2c');
    const comparison = comparisonOf(
      await resolvePrComparison({
        cwd: clone,
        sourceBranch: 'feature',
        targetBranch: 'main',
        expectedHeadOid: later,
      })
    );
    expect(comparison.headOid).toBe(later);
    git(upstream, 'reset', '-q', '--hard', oids.H2);
    git(
      clone,
      'fetch',
      '-q',
      '-f',
      'origin',
      '+feature:refs/remotes/origin/feature'
    );
  });

  it('lists a pure rename and a rename with an edit by both paths', async () => {
    git(upstream, 'mv', 'c.txt', 'd.txt');
    oids.H3 = commit(upstream, 'H3 pure rename');
    git(clone, 'fetch', '-q', 'origin');
    const h3 = await readPrDiffManifest(
      clone,
      comparisonOf(
        await resolvePrComparison({
          cwd: clone,
          sourceBranch: 'feature',
          targetBranch: 'main',
          expectedHeadOid: oids.H3,
        })
      )
    );
    expect(byPath(h3.files, 'd.txt')).toMatchObject({
      oldPath: 'c.txt',
      status: 'renamed',
      similarity: 100,
      additions: 0,
      deletions: 0,
    });

    git(upstream, 'mv', 'd.txt', 'e.txt');
    write(upstream, 'e.txt', numbered(30).replace('line 20\n', 'twenty\n'));
    oids.H4 = commit(upstream, 'H4 rename and edit');
    git(clone, 'fetch', '-q', 'origin');
    const h4 = await readPrDiffManifest(
      clone,
      comparisonOf(
        await resolvePrComparison({
          cwd: clone,
          sourceBranch: 'feature',
          targetBranch: 'main',
          expectedHeadOid: oids.H4,
        })
      )
    );
    const renamed = byPath(h4.files, 'e.txt');
    expect(renamed).toMatchObject({ oldPath: 'c.txt', status: 'renamed' });
    expect(renamed.similarity).toBeLessThan(100);
    expect([renamed.additions, renamed.deletions]).toEqual([1, 1]);
  });

  it('moves the target without pretending the source was pushed', async () => {
    git(upstream, 'checkout', '-q', 'main');
    write(upstream, 'z.txt', 'on main only\n');
    oids.B2 = commit(upstream, 'B2');
    git(upstream, 'checkout', '-q', 'feature');
    git(clone, 'fetch', '-q', 'origin');
    const comparison = comparisonOf(
      await resolvePrComparison({
        cwd: clone,
        sourceBranch: 'feature',
        targetBranch: 'main',
        expectedHeadOid: oids.H4,
      })
    );
    expect(comparison).toMatchObject({
      headOid: oids.H4,
      targetOid: oids.B2,
      mergeBaseOid: oids.B1,
    });
    const manifest = await readPrDiffManifest(clone, comparison);
    expect(manifest.files.map((f) => f.path)).not.toContain('z.txt');
  });

  it('compares against the provider’s target, not the clone’s newer one', async () => {
    // origin/main is at B2 now; the provider still says B1.
    const comparison = comparisonOf(
      await resolvePrComparison({
        cwd: clone,
        sourceBranch: 'feature',
        targetBranch: 'main',
        expectedHeadOid: oids.H4,
        expectedTargetOid: oids.B1,
      })
    );
    expect(comparison).toMatchObject({
      targetOid: oids.B1,
      mergeBaseOid: oids.B1,
      targetRef: 'main',
      targetVerified: true,
    });
  });

  it('says so when the provider’s target is not in the clone', async () => {
    const result = await resolvePrComparison({
      cwd: clone,
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedHeadOid: oids.H4,
      expectedTargetOid: 'd'.repeat(40),
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'target-unavailable',
        expectedTargetOid: 'd'.repeat(40),
      }),
    });
  });

  it('fetches a target branch the clone has never seen', async () => {
    // A stacked pull request retargeted onto a branch pushed after the
    // clone last fetched.
    git(upstream, 'branch', 'release', oids.B1);
    expect(() =>
      git(clone, 'rev-parse', '--verify', '-q', 'origin/release')
    ).toThrow();
    const comparison = comparisonOf(
      await resolvePrComparison({
        cwd: clone,
        sourceBranch: 'feature',
        targetBranch: 'release',
        expectedHeadOid: oids.H4,
      })
    );
    expect(comparison).toMatchObject({
      targetOid: oids.B1,
      targetRef: 'origin/release',
    });
    git(upstream, 'branch', '-D', 'release');
  });

  it('refuses a head with no history in common with the target', async () => {
    git(upstream, 'checkout', '-q', '--orphan', 'unrelated');
    git(upstream, 'rm', '-q', '-rf', '.');
    write(upstream, 'other.txt', 'force-pushed over everything\n');
    const orphan = commit(upstream, 'unrelated root');
    git(upstream, 'branch', '-f', 'feature', orphan);
    git(upstream, 'checkout', '-q', 'feature');
    git(
      clone,
      'fetch',
      '-q',
      '-f',
      'origin',
      '+feature:refs/remotes/origin/feature'
    );
    const result = await resolvePrComparison({
      cwd: clone,
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedHeadOid: orphan,
    });
    expect(!result.ok && result.error.code).toBe('no-merge-base');
  });

  it.each([
    ['', 'invalid-request'],
    ['-v', 'invalid-request'],
    ['HEAD~1', 'invalid-request'],
    ['feature..main', 'invalid-request'],
    // Not the checked-out HEAD, and not origin/HEAD either: in a clone
    // that is the remote's default branch.
    ['HEAD', 'invalid-request'],
    ['no-such-branch', 'source-missing'],
  ])('never falls back to HEAD for source %j', async (source, code) => {
    const result = await resolvePrComparison({
      cwd: clone,
      sourceBranch: source,
      targetBranch: 'main',
    });
    expect(!result.ok && result.error.code).toBe(code);
  });

  it('rejects an expected head that is not an object id', async () => {
    const result = await resolvePrComparison({
      cwd: clone,
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedHeadOid: 'HEAD',
    });
    expect(!result.ok && result.error.code).toBe('invalid-request');
  });

  it('reads without touching the index', async () => {
    const index = join(clone, '.git', 'index');
    const before = {
      bytes: readFileSync(index),
      mtime: statSync(index).mtimeMs,
    };
    const comparison = comparisonOf(
      await resolvePrComparison({
        cwd: clone,
        sourceBranch: 'feature',
        targetBranch: 'main',
        expectedHeadOid: oids.H4,
      })
    );
    await readPrDiffManifest(clone, comparison);
    await readPrDiffPatch(clone, comparison);
    expect(readFileSync(index).equals(before.bytes)).toBe(true);
    expect(statSync(index).mtimeMs).toBe(before.mtime);
  });
});

describe('the manifest over special changes', () => {
  let repo: string;
  let comparison: PrComparison;
  let files: PrDiffManifestFile[];

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), 'n10-pr-special-'));
    initRepo(repo);
    write(repo, 'moved.txt', numbered(30));
    write(repo, 'renamed-edit.txt', numbered(30));
    write(repo, 'mode.sh', 'echo hi\n');
    write(repo, 'nonl.txt', 'x\n');
    write(repo, 'crlf.txt', 'a\r\nb\r\n');
    write(repo, 'bin.dat', Buffer.from([0, 1, 2]));
    write(repo, 'copysrc.txt', numbered(40));
    write(repo, 'deleted.txt', 'old\n');
    write(repo, 'becomes-link', 'plain file\n');
    symlinkSync('target1', join(repo, 'link'));
    const base = commit(repo, 'base');

    git(repo, 'checkout', '-q', '-b', 'special');
    mkdirSync(join(repo, 'sub dir'));
    git(repo, 'mv', 'moved.txt', 'sub dir/moved.txt');
    git(repo, 'mv', 'renamed-edit.txt', 'renamed2.txt');
    write(repo, 'renamed2.txt', numbered(30).replace('line 5\n', 'five\n'));
    chmodSync(join(repo, 'mode.sh'), 0o755);
    write(repo, 'nonl.txt', 'x');
    write(repo, 'crlf.txt', 'a\r\nc\r\n');
    write(repo, 'bin.dat', Buffer.from([0, 9, 9]));
    write(repo, 'copied.txt', numbered(40));
    write(repo, 'copysrc.txt', numbered(40).replace('line 1\n', 'one\n'));
    unlinkSync(join(repo, 'deleted.txt'));
    unlinkSync(join(repo, 'becomes-link'));
    symlinkSync('link', join(repo, 'becomes-link'));
    unlinkSync(join(repo, 'link'));
    symlinkSync('target2', join(repo, 'link'));
    write(repo, 'tab\tname.txt', 'tab\n');
    write(repo, 'päth.txt', 'unicode\n');
    write(repo, 'quote"d.txt', 'quote\n');
    write(repo, 'star*.txt', 'literal star\n');
    write(repo, 'star-other.txt', 'not the star\n');
    git(repo, 'add', '-A');
    // A gitlink with no checkout behind it: committed straight from the
    // index, since `add -A` would drop it again.
    git(
      repo,
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${base},vendor/lib`
    );
    git(repo, 'commit', '-q', '-m', 'special changes');
    git(repo, 'checkout', '-q', 'main');

    comparison = comparisonOf(
      await resolvePrComparison({
        cwd: repo,
        sourceBranch: 'special',
        targetBranch: 'main',
      })
    );
    files = (await readPrDiffManifest(repo, comparison)).files;
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('marks a comparison read from a local branch as unverified', () => {
    expect(comparison).toMatchObject({
      sourceRef: 'special',
      targetRef: 'main',
      headVerified: false,
      targetVerified: false,
    });
  });

  it.each<[string, Partial<PrDiffManifestFile>]>([
    [
      'sub dir/moved.txt',
      {
        oldPath: 'moved.txt',
        status: 'renamed',
        similarity: 100,
        additions: 0,
        deletions: 0,
      },
    ],
    [
      'renamed2.txt',
      {
        oldPath: 'renamed-edit.txt',
        status: 'renamed',
        additions: 1,
        deletions: 1,
      },
    ],
    [
      // Copies are not detected: a copy is new code, read as added.
      'copied.txt',
      { oldPath: 'copied.txt', status: 'added', additions: 40 },
    ],
    ['copysrc.txt', { status: 'modified', additions: 1, deletions: 1 }],
    [
      'mode.sh',
      {
        status: 'modified',
        oldMode: '100644',
        newMode: '100755',
        additions: 0,
        deletions: 0,
      },
    ],
    ['nonl.txt', { status: 'modified', additions: 1, deletions: 1 }],
    [
      'crlf.txt',
      { status: 'modified', kind: 'text', additions: 1, deletions: 1 },
    ],
    ['bin.dat', { kind: 'binary', additions: null, deletions: null }],
    ['link', { kind: 'symlink', oldMode: '120000', newMode: '120000' }],
    [
      'vendor/lib',
      { kind: 'submodule', status: 'added', oldMode: null, newMode: '160000' },
    ],
    [
      'deleted.txt',
      { status: 'deleted', newMode: null, newOid: null, deletions: 1 },
    ],
    [
      'becomes-link',
      {
        status: 'type-changed',
        oldMode: '100644',
        newMode: '120000',
        kind: 'symlink',
      },
    ],
    ['tab\tname.txt', { status: 'added', oldOid: null }],
    ['päth.txt', { status: 'added' }],
    ['quote"d.txt', { status: 'added' }],
    ['star*.txt', { status: 'added' }],
  ])('lists %j with what git knows about it', (path, expected) => {
    expect(byPath(files, path)).toMatchObject(expected);
  });

  it('agrees with the patch on every path and status', async () => {
    const patch = await readPrDiffPatch(repo, comparison);
    expect(patch.truncated).toBe(false);
    const parsed = parseDiffFiles(patch.text);
    const key = (f: { path: string; oldPath: string; status: string }) =>
      `${f.status} ${f.oldPath} -> ${f.path}`;
    expect(parsed.map(key).sort()).toEqual(files.map(key).sort());
  });

  it('reads the same whatever the repository’s diff config says', async () => {
    const before = {
      manifest: await readPrDiffManifest(repo, comparison),
      patch: await readPrDiffPatch(repo, comparison),
    };
    const hostile: [string, string][] = [
      ['diff.ignoreSubmodules', 'all'],
      ['diff.submodule', 'log'],
      ['diff.noprefix', 'true'],
      ['diff.mnemonicPrefix', 'true'],
      ['diff.renames', 'copies'],
      ['color.ui', 'always'],
      ['core.quotePath', 'false'],
    ];
    try {
      for (const [key, value] of hostile) git(repo, 'config', key, value);
      expect(await readPrDiffManifest(repo, comparison)).toEqual(
        before.manifest
      );
      const patch = await readPrDiffPatch(repo, comparison);
      // Quoting may differ; what the parser reads out of it may not.
      expect(parseDiffFiles(patch.text)).toEqual(
        parseDiffFiles(before.patch.text)
      );
    } finally {
      for (const [key] of hostile) git(repo, 'config', '--unset', key);
    }
  });

  it('reads one file by a literal path, not a glob', async () => {
    const patch = await readPrDiffPatch(repo, comparison, {
      paths: ['star*.txt'],
    });
    expect(parseDiffFiles(patch.text).map((f) => f.path)).toEqual([
      'star*.txt',
    ]);
  });

  it('reads a rename as a rename when asked by both of its paths', async () => {
    const patch = await readPrDiffPatch(repo, comparison, {
      paths: ['renamed-edit.txt', 'renamed2.txt'],
    });
    expect(parseDiffFiles(patch.text)).toEqual([
      expect.objectContaining({
        path: 'renamed2.txt',
        oldPath: 'renamed-edit.txt',
        status: 'renamed',
      }),
    ]);
  });

  it('refuses bounds that are not object ids', async () => {
    await expect(
      readPrDiffPatch(repo, {
        mergeBaseOid: 'main',
        headOid: comparison.headOid,
      })
    ).rejects.toThrow('Not an object id');
  });
});

describe('a manifest past the file endpoint limits', () => {
  it('lists all 3,001 files', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'n10-pr-wide-'));
    try {
      initRepo(repo);
      write(repo, 'README.md', 'wide\n');
      commit(repo, 'base');
      git(repo, 'checkout', '-q', '-b', 'wide');
      for (let i = 0; i < 3001; i++) {
        write(repo, `files/${String(i).padStart(4, '0')}.txt`, `${i}\n`);
      }
      commit(repo, 'three thousand and one files');
      const manifest = await readPrDiffManifest(
        repo,
        comparisonOf(
          await resolvePrComparison({
            cwd: repo,
            sourceBranch: 'wide',
            targetBranch: 'main',
          })
        )
      );
      expect(manifest.complete).toBe(true);
      expect(manifest.files).toHaveLength(3001);
      expect(manifest.files.at(-1)).toMatchObject({
        path: 'files/3000.txt',
        additions: 1,
      });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
