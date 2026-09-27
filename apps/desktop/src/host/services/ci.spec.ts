import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the renderer sends for CI reaches a provider's request paths, so
 * it is checked before any read starts.
 */

const core = vi.hoisted(() => ({
  readCiOverview: vi
    .fn()
    .mockResolvedValue({ provider: 'github', pipelines: [] }),
  readCiLog: vi.fn().mockResolvedValue({ text: '' }),
}));
vi.mock('@n10/core', () => core);
vi.mock('./repo.js', () => ({ requireRepo: () => '/repo' }));
vi.mock('./pull-requests.js', () => ({
  resolveProvider: vi.fn(),
  lookupPullRequest: vi.fn(),
}));

const { getCiLog, getCiOverview } = await import('./ci.js');

beforeEach(() => {
  core.readCiOverview.mockClear();
  core.readCiLog.mockClear();
});

describe('getCiOverview', () => {
  it('reads the open repository', async () => {
    await getCiOverview(7);
    expect(core.readCiOverview).toHaveBeenCalledWith(
      '/repo',
      7,
      expect.anything()
    );
  });

  it.each([0, -1, 1.5, '7', null])('refuses %j', async (prId) => {
    await expect(getCiOverview(prId)).rejects.toThrow('Invalid PR id');
    expect(core.readCiOverview).not.toHaveBeenCalled();
  });
});

describe('getCiLog', () => {
  it('passes on only the fields of a valid reference', async () => {
    await getCiLog({ provider: 'github', jobId: 3, url: 'https://evil' });
    expect(core.readCiLog).toHaveBeenCalledWith(
      '/repo',
      { provider: 'github', jobId: 3 },
      expect.anything()
    );
  });

  it('refuses anything else', async () => {
    await expect(
      getCiLog({ provider: 'github', jobId: '3/../../x' })
    ).rejects.toThrow('Invalid CI log reference');
    expect(core.readCiLog).not.toHaveBeenCalled();
  });
});
