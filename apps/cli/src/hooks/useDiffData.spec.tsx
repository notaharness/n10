import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import type * as Core from '@n10/core';
import { EngineProvider, useDiffData, useFileDiffData } from '@n10/app-core';
import { reviewEngineFixture } from './review-engine-fixture.js';

const reads = vi.hoisted(() => ({ files: vi.fn(), patch: vi.fn() }));
vi.mock('@n10/core', async (original) => ({
  ...(await original<typeof Core>()),
  fetchRefs: async () => true,
  resolveRef: async (_repo: string, branch: string) => branch,
  gitLine: async (args: string[]) => args.at(-1) ?? '',
  readDiffFiles: reads.files,
  fetchFileDiffText: reads.patch,
}));
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
function mountProbe(initialPr: number | null) {
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
    const diff = useDiffData(pr, `feature-${pr}`, 'main', undefined);
    const selected = useFileDiffData(diff.request, filename);
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
    unmount: () => {
      ui.unmount();
      engine.reviews.dispose();
    },
  };
}
beforeEach(() => {
  reads.files.mockReset().mockResolvedValue([file]);
  reads.patch.mockReset().mockResolvedValue(patch);
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
      'feature-42^{commit}',
      'main^{commit}',
      'foo.ts',
      expect.objectContaining({ sourceRef: 'feature-42^{commit}' })
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
    reads.files.mockResolvedValueOnce([{ ...file, filename: 'next.ts' }]);
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
});
