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
  // The callback promisify appends comes last, after the options.
  mockExecFile.mockImplementationOnce((...args: unknown[]) => {
    const cb = args.at(-1) as (err: null, result: { stdout: string }) => void;
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
  });
}

const project = { owner: 'octocat', repo: 'hello-world', username: 'octocat' };

/** A full commit id made of one hex digit. */
const oid = (digit: string) => digit.repeat(40);

beforeEach(() => mockExecFile.mockReset());

describe('fetchMergedBranches', () => {
  it('answers each merged branch with the head commits that merged', async () => {
    searchAnswers([
      { headRefName: 'feat-a', headRefOid: oid('a') },
      { headRefName: 'feat-a', headRefOid: oid('b') },
      { headRefName: 'feat-b', headRefOid: oid('c') },
      { headRefName: 'not-asked', headRefOid: oid('d') },
    ]);

    const merged = await githubProvider.fetchMergedBranches?.({}, project, [
      'feat-a',
      'feat-b',
    ]);

    expect(merged).toEqual(
      new Map([
        ['feat-a', [oid('a'), oid('b')]],
        ['feat-b', [oid('c')]],
      ])
    );
  });

  it('asks for the head commit', async () => {
    searchAnswers([]);
    await githubProvider.fetchMergedBranches?.({}, project, ['feat-a']);
    const args = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(args.join(' ')).toContain('headRefOid');
  });

  it('keeps a branch merged whose pull request came back without its head commit', async () => {
    searchAnswers([{ headRefName: 'feat-a' }]);
    const merged = await githubProvider.fetchMergedBranches?.({}, project, [
      'feat-a',
    ]);
    // The badge shows; with no head, nothing vouches for its commits.
    expect(merged).toEqual(new Map([['feat-a', []]]));
  });

  // Heads reach `git fetch origin <head>` and `git rev-parse`: an option
  // or a ref name there is not a commit the pull request merged.
  it('accepts only full commit ids as heads, lowercased', async () => {
    searchAnswers([
      { headRefName: 'feat-a', headRefOid: '--upload-pack=touch /tmp/x' },
      { headRefName: 'feat-a', headRefOid: 'HEAD' },
      { headRefName: 'feat-a', headRefOid: 'abc123' },
      { headRefName: 'feat-a', headRefOid: oid('E') },
    ]);
    const merged = await githubProvider.fetchMergedBranches?.({}, project, [
      'feat-a',
    ]);
    expect(merged).toEqual(new Map([['feat-a', [oid('e')]]]));
  });
});
