import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigServiceOptions } from '@n10/engine';

const state = vi.hoisted(() => ({
  options: [] as ConfigServiceOptions[],
  reload: vi.fn(),
  pullRequests: {},
  providers: [],
  restartSync: vi.fn(),
}));
vi.mock('@n10/engine', () => ({
  createConfigService: (options: ConfigServiceOptions) => {
    state.options.push(options);
    return { repo: options.repo, reload: state.reload };
  },
}));
vi.mock('./repo.js', () => ({ PROVIDERS: state.providers }));
vi.mock('./pull-requests.js', () => ({ pullRequests: state.pullRequests }));
vi.mock('./remote-sync.js', () => ({ startRemoteSyncLoop: state.restartSync }));

beforeEach(() => {
  vi.resetModules();
  state.options = [];
  state.reload.mockClear();
});

describe('repository config lifetime', () => {
  it('creates the service with the host effect ports before settings are read', async () => {
    const scope = await import('./config-scope.js');
    expect(() => scope.activeConfigService()).toThrow();
    scope.openConfigService('/repo-a');
    expect(state.options).toEqual([
      {
        repo: '/repo-a',
        providers: state.providers,
        pullRequests: state.pullRequests,
        restartSync: state.restartSync,
      },
    ]);
    expect(scope.activeConfigService().repo).toBe('/repo-a');
    scope.activeConfigService();
    expect(state.reload).not.toHaveBeenCalled();
  });

  it('reloads after same-repo detection and replaces the scope on a switch', async () => {
    const scope = await import('./config-scope.js');
    scope.openConfigService('/repo-a');
    const first = scope.activeConfigService();
    scope.openConfigService('/repo-a');
    expect(scope.activeConfigService()).toBe(first);
    expect(state.reload).toHaveBeenCalledOnce();
    scope.openConfigService('/repo-b');
    expect(scope.activeConfigService()).not.toBe(first);
    expect(scope.activeConfigService().repo).toBe('/repo-b');
    expect(state.options).toHaveLength(2);
  });
});
