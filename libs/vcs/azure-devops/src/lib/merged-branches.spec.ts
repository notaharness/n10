import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { azureDevOpsProvider } from './provider.js';
import { resetAdoTransport } from './request.js';

// The merged-branch sweep deletes branches on the strength of this
// answer, so it must say which commits merged, not just which names.

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function completedPrs(value: object[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify({ value })),
    json: () => Promise.resolve({ value }),
  } as unknown as Response;
}

const auth = { pat: 'test-pat' };
const project = { org: 'myorg', project: 'myproject', repo: 'myrepo' };

beforeEach(() => {
  mockFetch.mockReset();
  resetAdoTransport();
});

describe('fetchMergedBranches', () => {
  // Two completed pull requests from `feature/retry`, one from a branch
  // nobody asked about. Read rather than imported, as a data file.
  it('answers each merged branch with the source commits that merged', async () => {
    const { value } = JSON.parse(
      readFileSync(
        new URL('./__fixtures__/completed-prs.json', import.meta.url),
        'utf8'
      )
    ) as { value: object[] };
    mockFetch.mockResolvedValue(completedPrs(value));

    const merged = await azureDevOpsProvider.fetchMergedBranches?.(
      auth,
      project,
      ['feature/retry']
    );

    expect(merged).toEqual(
      new Map([
        [
          'feature/retry',
          [
            '3c7d1e9a0b2f4c6e8a1d3f5b7c9e0a2b4d6f8a1c',
            'b1a2c3d4e5f60718293a4b5c6d7e8f9012345678',
          ],
        ],
      ])
    );
  });

  it('leaves out a pull request that came back without its source commit', async () => {
    mockFetch.mockResolvedValue(
      completedPrs([{ sourceRefName: 'refs/heads/feat-a' }])
    );

    const merged = await azureDevOpsProvider.fetchMergedBranches?.(
      auth,
      project,
      ['feat-a']
    );

    expect(merged?.size).toBe(0);
  });
});
