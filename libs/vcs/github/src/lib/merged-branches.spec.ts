import { describe, it, expect, vi, beforeEach } from 'vitest';
import { githubProvider } from './provider.js';

// The merged-branch sweep deletes branches on the strength of this
// answer, so it must say which commits merged, not just which names.

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execSync: vi.fn(),
}));

function searchAnswers(nodes: object[]) {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      cb: (err: null, result: { stdout: string }) => void
    ) => {
      cb(null, {
        stdout: JSON.stringify({
          data: {
            search: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes,
            },
          },
        }),
      });
    }
  );
}

const project = { owner: 'octocat', repo: 'hello-world', username: 'octocat' };

beforeEach(() => mockExecFile.mockReset());

describe('fetchMergedBranches', () => {
  it('answers each merged branch with the head commits that merged', async () => {
    searchAnswers([
      { headRefName: 'feat-a', headRefOid: 'aaa' },
      { headRefName: 'feat-a', headRefOid: 'bbb' },
      { headRefName: 'feat-b', headRefOid: 'ccc' },
      { headRefName: 'not-asked', headRefOid: 'ddd' },
    ]);

    const merged = await githubProvider.fetchMergedBranches?.({}, project, [
      'feat-a',
      'feat-b',
    ]);

    expect(merged).toEqual(
      new Map([
        ['feat-a', ['aaa', 'bbb']],
        ['feat-b', ['ccc']],
      ])
    );
  });

  it('asks for the head commit', async () => {
    searchAnswers([]);
    await githubProvider.fetchMergedBranches?.({}, project, ['feat-a']);
    const args = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(args.join(' ')).toContain('headRefOid');
  });

  it('leaves out a pull request that came back without its head commit', async () => {
    searchAnswers([{ headRefName: 'feat-a' }]);
    const merged = await githubProvider.fetchMergedBranches?.({}, project, [
      'feat-a',
    ]);
    expect(merged?.size).toBe(0);
  });
});
