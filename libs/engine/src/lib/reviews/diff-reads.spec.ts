import { beforeEach, expect, it, vi } from 'vitest';
import {
  fetchRefs,
  resolveRef,
  gitLine,
  readDiffFiles,
  fetchFileDiffText,
  fetchDiffText,
  fetchWorktreeDiffText,
} from '@n10/core';
import { createDiffReads } from './diff-reads.js';
import { readResourceValue } from './read-resource.js';

vi.mock('@n10/core', () => ({
  fetchRefs: vi.fn(),
  resolveRef: vi.fn(),
  gitLine: vi.fn(),
  readDiffFiles: vi.fn(),
  fetchFileDiffText: vi.fn(),
  fetchDiffText: vi.fn(),
  fetchWorktreeDiffText: vi.fn(),
}));
const request = {
  sourceBranch: 'feature',
  targetBranch: 'main',
  headSha: 'head',
};
const find = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchRefs).mockResolvedValue(true);
  vi.mocked(resolveRef).mockImplementation(
    async (_cwd, branch) => `origin/${branch}`
  );
  vi.mocked(gitLine).mockImplementation(async (args) =>
    args.at(-1)?.endsWith('^{commit}')
      ? args.at(-1) === 'head^{commit}'
        ? 'head'
        : 'base'
      : 'head'
  );
  vi.mocked(readDiffFiles).mockResolvedValue([
    {
      filename: 'a.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      binary: false,
    },
  ]);
  vi.mocked(fetchFileDiffText).mockResolvedValue('file patch');
  vi.mocked(fetchDiffText).mockResolvedValue('full patch');
});

it('shares metadata and immutable commit refs across file and full patches', async () => {
  const diff = createDiffReads('/repo/a', { find });
  await readResourceValue(diff.files(request));
  expect(fetchFileDiffText).not.toHaveBeenCalled();
  expect(await readResourceValue(diff.file(request, 'a.ts'))).toBe(
    'file patch'
  );
  expect(await readResourceValue(diff.full(request))).toEqual({
    text: 'full patch',
    head: 'head',
  });
  expect(readDiffFiles).toHaveBeenCalledExactlyOnceWith(
    '/repo/a',
    'head',
    'base'
  );
  expect(fetchFileDiffText).toHaveBeenCalledWith(
    '/repo/a',
    'feature',
    'main',
    'a.ts',
    expect.objectContaining({ sourceRef: 'head', targetRef: 'base' })
  );
  expect(fetchDiffText).toHaveBeenCalledWith(
    '/repo/a',
    'feature',
    'main',
    expect.objectContaining({ sourceRef: 'head', targetRef: 'base' })
  );
});

it('skips a matching source fetch but refreshes a changed source and bounds target freshness', async () => {
  const diff = createDiffReads('/repo/a', { find });
  await readResourceValue(diff.files(request));
  expect(fetchRefs).toHaveBeenCalledExactlyOnceWith({
    cwd: '/repo/a',
    refs: ['main'],
    maxAgeMs: 300_000,
  });
  await readResourceValue(diff.files({ ...request, headSha: 'new-head' }));
  expect(fetchRefs).toHaveBeenCalledWith({ cwd: '/repo/a', refs: ['feature'] });
});

it('never shares results across repositories and reads live diffs from the resolved checkout', async () => {
  const first = createDiffReads('/repo/a', { find });
  const second = createDiffReads('/repo/b', { find });
  await readResourceValue(first.files(request));
  await readResourceValue(second.files(request));
  expect(readDiffFiles).toHaveBeenCalledWith('/repo/b', 'head', 'base');
  expect(gitLine).toHaveBeenCalledWith(expect.any(Array), { cwd: '/repo/b' });
  find.mockResolvedValue({ path: '/checkouts/actual' });
  vi.mocked(fetchWorktreeDiffText).mockResolvedValue('live');
  expect(await readResourceValue(second.worktree('feature', 'main'))).toBe(
    'live'
  );
  expect(fetchWorktreeDiffText).toHaveBeenCalledWith(
    '/checkouts/actual',
    'main'
  );
});

it('propagates metadata failures instead of claiming an empty diff', async () => {
  vi.mocked(readDiffFiles).mockRejectedValue(new Error('Cannot read files'));
  const diff = createDiffReads('/repo', { find });
  await expect(readResourceValue(diff.full(request))).rejects.toThrow(
    'Cannot read files'
  );
  expect(fetchDiffText).not.toHaveBeenCalled();
});
