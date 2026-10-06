import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRefs,
  fetchWorktreeDiffText,
  readBlobImage,
  readPrDiffManifest,
  readPrDiffPatch,
  readRevisionRangeManifest,
  resolvePrComparison,
} from '@n10/core';
import type { PrComparison } from '@n10/core';
import { createDiffReads } from './diff-reads.js';
import { readResourceValue } from './read-resource.js';

/**
 * Diff reads at exact commits. Resolution itself is core's, tested
 * against real Git there; this is what the engine adds: request
 * parsing, the repository a request may be answered for, and which
 * reads are shared or read again.
 */

vi.mock('@n10/core', () => ({
  WHOLE_FILE_CONTEXT: 2_147_483_647,
  fetchRefs: vi.fn(),
  fetchWorktreeDiffText: vi.fn(),
  readBlobImage: vi.fn(),
  readPrDiffManifest: vi.fn(),
  readPrDiffPatch: vi.fn(),
  readRevisionRangeManifest: vi.fn(),
  resolvePrComparison: vi.fn(),
}));

const HEAD = 'b'.repeat(40);
const TARGET = 'c'.repeat(40);
const BASE = 'a'.repeat(40);
const comparison = (headOid = HEAD): PrComparison => ({
  headOid,
  targetOid: TARGET,
  mergeBaseOid: BASE,
  sourceRef: 'origin/feature',
  targetRef: 'origin/main',
  headVerified: true,
  targetVerified: true,
});
const request = {
  repo: '/repo/a',
  sourceBranch: 'feature',
  targetBranch: 'main',
  expectedHeadOid: HEAD,
};
const patchRequest = { repo: '/repo/a', mergeBaseOid: BASE, headOid: HEAD };
const find = vi.fn();
let current = true;
const reads = (repo = '/repo/a') =>
  createDiffReads(repo, () => current, { find }, {});

beforeEach(() => {
  vi.resetAllMocks();
  current = true;
  vi.mocked(fetchRefs).mockResolvedValue(true);
  vi.mocked(resolvePrComparison).mockImplementation(async (req) => ({
    ok: true,
    comparison: comparison(req.expectedHeadOid),
  }));
  vi.mocked(readPrDiffManifest).mockImplementation(async (_cwd, c) => ({
    comparison: c,
    files: [],
    complete: true,
  }));
  vi.mocked(readPrDiffPatch).mockResolvedValue({
    text: 'patch',
    truncated: false,
    limitBytes: 1,
  });
});

describe('manifest', () => {
  it('resolves in its repository with the provider head and lists the files', async () => {
    const diff = reads();
    expect(await readResourceValue(diff.manifest(request))).toEqual({
      ok: true,
      manifest: { comparison: comparison(), files: [], complete: true },
    });
    expect(resolvePrComparison).toHaveBeenCalledWith({
      cwd: '/repo/a',
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedHeadOid: HEAD,
    });
    expect(readPrDiffManifest).toHaveBeenCalledWith(
      '/repo/a',
      comparison(),
      {}
    );
  });

  it('lists under the ceiling the environment sets', async () => {
    const diff = createDiffReads(
      '/repo/a',
      () => true,
      { find },
      {
        N10_DIFF_MANIFEST_MAX_BYTES: '400',
      }
    );
    await readResourceValue(diff.manifest(request));
    expect(readPrDiffManifest).toHaveBeenCalledWith('/repo/a', comparison(), {
      maxBytes: 400,
    });
  });

  it('keeps an unpinned target fresh, and fetches nothing for a pinned one', async () => {
    const diff = reads();
    await readResourceValue(diff.manifest(request));
    expect(fetchRefs).toHaveBeenCalledExactlyOnceWith({
      cwd: '/repo/a',
      refs: ['main'],
      maxAgeMs: 300_000,
    });
    vi.mocked(fetchRefs).mockClear();
    await readResourceValue(
      diff.manifest({ ...request, expectedTargetOid: TARGET })
    );
    expect(fetchRefs).not.toHaveBeenCalled();
  });

  it('answers a comparison failure as data, and reads it again', async () => {
    const error = { code: 'head-unavailable' as const, message: 'gone' };
    vi.mocked(resolvePrComparison).mockResolvedValueOnce({ ok: false, error });
    const diff = reads();
    expect(await readResourceValue(diff.manifest(request))).toEqual({
      ok: false,
      error,
    });
    expect(readPrDiffManifest).not.toHaveBeenCalled();
    expect(await readResourceValue(diff.manifest(request))).toMatchObject({
      ok: true,
    });
  });

  it('re-resolves branches on invalidation without listing the same commits twice', async () => {
    const diff = reads();
    await readResourceValue(diff.manifest(request));
    diff.invalidate();
    await readResourceValue(diff.manifest(request));
    expect(resolvePrComparison).toHaveBeenCalledTimes(2);
    expect(readPrDiffManifest).toHaveBeenCalledOnce();
  });

  it('answers with the comparison just resolved when a moved target shares the listing', async () => {
    const diff = reads();
    await readResourceValue(diff.manifest(request));
    const moved = 'd'.repeat(40);
    // A parent merged into the target: the merge base stays its tip.
    vi.mocked(resolvePrComparison).mockResolvedValue({
      ok: true,
      comparison: {
        ...comparison(),
        targetOid: moved,
        targetRef: 'origin/master',
      },
    });
    const result = await readResourceValue(
      diff.manifest({ ...request, expectedTargetOid: moved })
    );
    expect(readPrDiffManifest).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      manifest: {
        comparison: { targetOid: moved, targetRef: 'origin/master' },
      },
    });
  });

  it('refuses a request for a repository that is not its own', async () => {
    const diff = reads();
    expect(
      await readResourceValue(diff.manifest({ ...request, repo: '/repo/b' }))
    ).toMatchObject({ ok: false, error: { code: 'repo-changed' } });
    expect(resolvePrComparison).not.toHaveBeenCalled();
  });

  it('drops an answer when the repository closes during the read', async () => {
    vi.mocked(readPrDiffManifest).mockImplementationOnce(async (_cwd, c) => {
      current = false;
      return { comparison: c, files: [], complete: true };
    });
    expect(await readResourceValue(reads().manifest(request))).toMatchObject({
      ok: false,
      error: { code: 'repo-changed' },
    });
  });

  it.each([
    [{ ...request, repo: 42 }, 'repo must be a string'],
    [{ ...request, sourceBranch: ['x'] }, 'sourceBranch must be a string'],
    [{ ...request, expectedHeadOid: 7 }, 'expectedHeadOid must be a string'],
    [null, 'repo must be a string'],
  ])('rejects a malformed request %#', (req, message) => {
    expect(() => reads().manifest(req)).toThrow(message);
  });
});

describe('patch', () => {
  it('reads between the given commits, for the given paths, once', async () => {
    const diff = reads();
    const req = { ...patchRequest, paths: ['src/a.ts'], context: 3 };
    expect(await readResourceValue(diff.patch(req))).toEqual({
      ok: true,
      patch: { text: 'patch', truncated: false, limitBytes: 1 },
    });
    diff.invalidate();
    await readResourceValue(diff.patch(req));
    expect(readPrDiffPatch).toHaveBeenCalledExactlyOnceWith(
      '/repo/a',
      { mergeBaseOid: BASE, headOid: HEAD },
      { paths: ['src/a.ts'], context: 3 }
    );
  });

  it('keeps the last two patches read, and joins one still being read', async () => {
    const diff = reads();
    const of = (path: string) => ({ ...patchRequest, paths: [path] });
    const calls = (path: string) =>
      vi
        .mocked(readPrDiffPatch)
        .mock.calls.filter(([, , o]) => o?.paths?.[0] === path).length;
    await Promise.all([
      readResourceValue(diff.patch(of('a'))),
      readResourceValue(diff.patch(of('a'))),
    ]);
    expect(calls('a')).toBe(1);
    for (const path of ['b', 'c'])
      await readResourceValue(diff.patch(of(path)));
    await readResourceValue(diff.patch(of('c')));
    expect(calls('c')).toBe(1);
    // Past the two kept: read again.
    await readResourceValue(diff.patch(of('a')));
    expect(calls('a')).toBe(2);
  });

  it('drops an answer when the repository closes mid-read', async () => {
    vi.mocked(readPrDiffPatch).mockImplementationOnce(async () => {
      current = false;
      return { text: '', truncated: false, limitBytes: 1 };
    });
    expect(await readResourceValue(reads().patch(patchRequest))).toMatchObject({
      ok: false,
      error: { code: 'repo-changed' },
    });
  });

  it.each([
    [{ ...patchRequest, paths: 'src/a.ts' }],
    [{ ...patchRequest, paths: [''] }],
    [{ ...patchRequest, paths: [3] }],
    [
      {
        ...patchRequest,
        paths: Array.from({ length: 1001 }, (_, i) => `f${i}`),
      },
    ],
    // Few paths, but more bytes than a command line should carry.
    [
      {
        ...patchRequest,
        paths: Array.from({ length: 3 }, () => 'x'.repeat(100_000)),
      },
    ],
  ])('rejects malformed paths %#', (req) => {
    expect(() => reads().patch(req)).toThrow('paths must');
  });

  it.each([-1, 1.5, '3', 2 ** 31])('rejects a context of %j', (context) => {
    expect(() => reads().patch({ ...patchRequest, context })).toThrow(
      'context must be'
    );
  });

  it('rejects bounds that are not strings', () => {
    expect(() => reads().patch({ ...patchRequest, headOid: 5 })).toThrow(
      'headOid must be a string'
    );
  });
});

describe('image', () => {
  const OID = 'd'.repeat(40);
  const image = {
    dataUrl: 'data:image/png;base64,AA==',
    contentType: 'image/png',
    bytes: 1,
  };

  it('reads a blob in its repository once, by id', async () => {
    vi.mocked(readBlobImage).mockResolvedValue({ ok: true, image });
    const diff = reads();
    const req = { repo: '/repo/a', oid: OID };
    expect(await readResourceValue(diff.image(req))).toEqual({
      ok: true,
      image,
    });
    await readResourceValue(diff.image(req));
    expect(readBlobImage).toHaveBeenCalledTimes(1);
    expect(readBlobImage).toHaveBeenCalledWith('/repo/a', OID);
  });

  it('keeps only the last few images, which the renderer caches', async () => {
    vi.mocked(readBlobImage).mockResolvedValue({ ok: true, image });
    const diff = reads();
    const oids = ['1', '2', '3'].map((c) => c.repeat(40));
    for (const oid of oids) {
      await readResourceValue(diff.image({ repo: '/repo/a', oid }));
    }
    await readResourceValue(diff.image({ repo: '/repo/a', oid: oids[2] }));
    expect(readBlobImage).toHaveBeenCalledTimes(3);
    await readResourceValue(diff.image({ repo: '/repo/a', oid: oids[0] }));
    expect(readBlobImage).toHaveBeenCalledTimes(4);
  });

  it('reads a refusal again rather than keeping it', async () => {
    vi.mocked(readBlobImage).mockResolvedValue({
      ok: false,
      error: { code: 'too-large', message: 'larger than 10 MB' },
    });
    const diff = reads();
    const req = { repo: '/repo/a', oid: OID };
    await readResourceValue(diff.image(req));
    await readResourceValue(diff.image(req));
    expect(readBlobImage).toHaveBeenCalledTimes(2);
  });

  it('answers only for its own repository', async () => {
    const diff = reads();
    const result = await readResourceValue(
      diff.image({ repo: '/repo/b', oid: OID })
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'repo-changed' },
    });
    expect(readBlobImage).not.toHaveBeenCalled();
  });

  it('drops an answer when the repository closes during the read', async () => {
    vi.mocked(readBlobImage).mockImplementation(async () => {
      current = false;
      return { ok: true, image };
    });
    const result = await readResourceValue(
      reads().image({ repo: '/repo/a', oid: OID })
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'repo-changed' },
    });
  });

  it('rejects an id that is not an object id', () => {
    expect(() =>
      reads().image({ repo: '/repo/a', oid: 'HEAD:secret' })
    ).toThrow('oid must be an object id');
    expect(() => reads().image({ repo: '/repo/a' })).toThrow(
      'oid must be an object id'
    );
  });
});

describe('rangeManifest', () => {
  const range = { repo: '/repo/a', from: BASE, to: HEAD, target: TARGET };
  beforeEach(() => {
    vi.mocked(readRevisionRangeManifest).mockResolvedValue({
      ok: true,
      range: {
        fromOid: BASE,
        toOid: HEAD,
        linear: true,
        backwards: false,
        base: { state: 'unchanged' },
      },
      manifest: { comparison: comparison(), files: [], complete: true },
    });
  });

  it.each(['from', 'to', 'target'] as const)(
    'refuses a %s that is not an object id',
    (key) => {
      expect(() => reads().rangeManifest({ ...range, [key]: 'main' })).toThrow(
        `${key} must be an object id`
      );
      expect(readRevisionRangeManifest).not.toHaveBeenCalled();
    }
  );

  it('answers only for its own repository', async () => {
    expect(
      await readResourceValue(
        reads().rangeManifest({ ...range, repo: '/repo/b' })
      )
    ).toMatchObject({ ok: false, error: { code: 'repo-changed' } });
    expect(readRevisionRangeManifest).not.toHaveBeenCalled();
  });

  it('drops an answer when the repository closes during the read', async () => {
    vi.mocked(readRevisionRangeManifest).mockImplementationOnce(async () => {
      current = false;
      return { ok: false, error: { code: 'to-unavailable', message: 'x' } };
    });
    expect(await readResourceValue(reads().rangeManifest(range))).toMatchObject(
      { ok: false, error: { code: 'repo-changed' } }
    );
  });

  it('reads a range that failed again, rather than keeping the failure', async () => {
    const diff = reads();
    vi.mocked(readRevisionRangeManifest).mockResolvedValueOnce({
      ok: false,
      error: { code: 'from-unavailable', message: 'not in this clone' },
    });
    expect(await readResourceValue(diff.rangeManifest(range))).toMatchObject({
      ok: false,
    });
    expect(await readResourceValue(diff.rangeManifest(range))).toMatchObject({
      ok: true,
    });
    expect(readRevisionRangeManifest).toHaveBeenCalledTimes(2);
  });

  it('reads the range in its repository, once', async () => {
    const diff = reads();
    expect(await readResourceValue(diff.rangeManifest(range))).toMatchObject({
      ok: true,
      range: { linear: true },
    });
    diff.invalidate();
    await readResourceValue(diff.rangeManifest(range));
    expect(readRevisionRangeManifest).toHaveBeenCalledExactlyOnceWith(
      { cwd: '/repo/a', from: BASE, to: HEAD, target: TARGET },
      {}
    );
  });
});

it('reads a live diff from the resolved checkout', async () => {
  find.mockResolvedValue({ path: '/checkouts/actual' });
  vi.mocked(fetchWorktreeDiffText).mockResolvedValue('live');
  expect(await readResourceValue(reads().worktree('feature', 'main'))).toBe(
    'live'
  );
  expect(fetchWorktreeDiffText).toHaveBeenCalledWith(
    '/checkouts/actual',
    'main'
  );
});
