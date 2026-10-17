import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import type * as Core from '@n10/core';
import { EngineProvider, useDiffData, useFileDiffData } from '@n10/app-core';
import { reviewEngineFixture } from './review-engine-fixture.js';

const reads = vi.hoisted(() => ({
  files: vi.fn(),
  patch: vi.fn(),
  resolve: vi.fn(),
}));
const oid = (branch: string) =>
  [...branch]
    .map((c) => c.charCodeAt(0).toString(16))
    .join('')
    .padEnd(40, '0');
vi.mock('@n10/core', async (original) => ({
  ...(await original<typeof Core>()),
  fetchRefs: async () => true,
  resolvePrComparison: reads.resolve,
  readPrDiffManifest: async (_cwd: string, comparison: Core.PrComparison) => ({
    comparison,
    files: await reads.files(),
    complete: true,
  }),
  readPrDiffPatch: reads.patch,
}));
const compared = async (req: Core.PrComparisonRequest) => ({
  ok: true,
  comparison: {
    headOid: req.expectedHeadOid ?? oid(req.sourceBranch),
    targetOid: oid(req.targetBranch),
    mergeBaseOid: oid(req.targetBranch),
    sourceRef: `origin/${req.sourceBranch}`,
    targetRef: `origin/${req.targetBranch}`,
    headVerified: req.expectedHeadOid !== undefined,
    targetVerified: false,
  },
});
const listed = (path: string): Core.PrDiffManifestFile => ({
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
  deletions: 0,
  oldSize: null,
  newSize: null,
});
const file = {
  filename: 'foo.ts',
  status: 'modified',
  additions: 1,
  deletions: 0,
  binary: false,
};
const patch = 'diff --git a/foo.ts b/foo.ts\n@@ -1 +1 @@\n-a\n+b\n';
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};
function mountProbe(initialPr: number | null, headSha?: string) {
  const engine = reviewEngineFixture();
  type Value = ReturnType<typeof useDiffData> & {
    file: ReturnType<typeof useFileDiffData>;
  };
  const out: { current: Value | null } = { current: null };
  const commits: {
    pr: number | null;
    files: string[];
    patch: string | null;
  }[] = [];
  function Probe({
    pr,
    filename,
  }: {
    pr: number | null;
    filename: string | null;
  }) {
    const diff = useDiffData(pr, `feature-${pr}`, 'main', headSha);
    const selected = useFileDiffData(
      diff.request,
      diff.files.find((item) => item.filename === filename) ?? null
    );
    useEffect(() => {
      out.current = { ...diff, file: selected };
      commits.push({
        pr,
        files: diff.files.map((item) => item.filename),
        patch: selected.data,
      });
    });
    return <Box />;
  }
  const tree = (pr: number | null, filename: string | null = null) => (
    <EngineProvider {...engine}>
      <Probe pr={pr} filename={filename} />
    </EngineProvider>
  );
  const ui = render(tree(initialPr));
  return {
    out,
    commits,
    set: (pr: number | null, filename: string | null = null) =>
      ui.rerender(tree(pr, filename)),
    unmount: () => ui.unmount(),
  };
}
beforeEach(() => {
  reads.resolve.mockReset().mockImplementation(compared);
  reads.files.mockReset().mockResolvedValue([listed('foo.ts')]);
  reads.patch
    .mockReset()
    .mockResolvedValue({ text: patch, truncated: false, limitBytes: 1 });
});

describe('engine diff bindings', () => {
  it('observes file metadata and loads only the selected file patch', async () => {
    const probe = mountProbe(42);
    await vi.waitFor(() => expect(probe.out.current?.files).toEqual([file]));
    expect(reads.patch).not.toHaveBeenCalled();
    probe.set(42, 'foo.ts');
    await vi.waitFor(() => expect(probe.out.current?.file.data).toBe(patch));
    expect(reads.patch).toHaveBeenCalledWith(
      '/repo',
      { mergeBaseOid: oid('main'), headOid: oid('feature-42') },
      { paths: ['foo.ts'] }
    );
    probe.unmount();
  });
  it('reads nothing without a selected pull request', async () => {
    const probe = mountProbe(null);
    await flush();
    expect(probe.out.current?.files).toEqual([]);
    expect(reads.files).not.toHaveBeenCalled();
    expect(reads.patch).not.toHaveBeenCalled();
    probe.unmount();
  });
  it('never paints the previous PR after selection becomes empty', async () => {
    const probe = mountProbe(42);
    probe.set(42, 'foo.ts');
    await vi.waitFor(() => expect(probe.out.current?.file.data).toBe(patch));
    probe.set(null);
    await flush();
    const empty = probe.commits.filter((commit) => commit.pr === null);
    expect(empty.length).toBeGreaterThan(0);
    expect(
      empty.every(
        (commit) => commit.files.length === 0 && commit.patch === null
      )
    ).toBe(true);
    probe.unmount();
  });
  it('observes the next comparison without publishing the previous file list', async () => {
    const probe = mountProbe(42);
    await vi.waitFor(() => expect(probe.out.current?.files).toEqual([file]));
    reads.files.mockResolvedValueOnce([listed('next.ts')]);
    probe.set(43);
    await vi.waitFor(() =>
      expect(probe.out.current?.files[0]?.filename).toBe('next.ts')
    );
    expect(
      probe.commits
        .filter((commit) => commit.pr === 43)
        .some((commit) => commit.files.includes('foo.ts'))
    ).toBe(false);
    probe.unmount();
  });
  it('diffs the provider’s head, not the local branch', async () => {
    const head = 'e'.repeat(40);
    const probe = mountProbe(42, head);
    probe.set(42, 'foo.ts');
    await vi.waitFor(() => expect(probe.out.current?.file.data).toBe(patch));
    expect(reads.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ expectedHeadOid: head })
    );
    expect(reads.patch).toHaveBeenCalledWith(
      '/repo',
      { mergeBaseOid: oid('main'), headOid: head },
      { paths: ['foo.ts'] }
    );
    probe.unmount();
  });
  it('reads a renamed file by both of its paths', async () => {
    reads.files.mockResolvedValue([
      { ...listed('new.ts'), oldPath: 'old.ts', status: 'renamed' },
    ]);
    const probe = mountProbe(42);
    probe.set(42, 'new.ts');
    await vi.waitFor(() => expect(probe.out.current?.file.data).toBe(patch));
    expect(probe.out.current?.files[0]).toMatchObject({
      filename: 'new.ts',
      previousFilename: 'old.ts',
      status: 'renamed',
    });
    expect(reads.patch).toHaveBeenCalledWith('/repo', expect.anything(), {
      paths: ['old.ts', 'new.ts'],
    });
    probe.unmount();
  });
  it('says why a comparison could not be made', async () => {
    reads.resolve.mockResolvedValue({
      ok: false,
      error: {
        code: 'head-unavailable',
        message: 'The pull request head is not in this clone',
      },
    });
    const probe = mountProbe(42, 'e'.repeat(40));
    await vi.waitFor(() =>
      expect(probe.out.current?.error).toBe(
        'The pull request head is not in this clone'
      )
    );
    expect(probe.out.current?.files).toEqual([]);
    probe.unmount();
  });
});
