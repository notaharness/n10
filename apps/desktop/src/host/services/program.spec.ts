import { expect, it, vi } from 'vitest';
import type { ConfigServiceOptions } from '@n10/engine';

const state = vi.hoisted(() => ({
  options: null as Omit<ConfigServiceOptions, 'repo'> | null,
  pullRequests: {},
  providers: [],
}));
vi.mock('@n10/engine', () => ({
  createPullRequestList: () => state.pullRequests,
  providerResolver: vi.fn(),
  createRepositoryService: (options: Omit<ConfigServiceOptions, 'repo'>) => {
    state.options = options;
    return {};
  },
}));
vi.mock('./providers.js', () => ({ PROVIDERS: state.providers }));

it('composes repository config with the shared PR cache and host sync port', async () => {
  const { setSyncRestarter } = await import('./program.js');
  const restart = vi.fn();
  setSyncRestarter(restart);
  expect(state.options?.providers).toBe(state.providers);
  expect(state.options?.pullRequests).toBe(state.pullRequests);
  state.options?.restartSync?.('/repo');
  expect(restart).toHaveBeenCalledExactlyOnceWith('/repo');
});
