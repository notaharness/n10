import { beforeEach, expect, it, vi } from 'vitest';
import type { RemoteSyncOptions, SyncNotice } from '@n10/engine';

const state = vi.hoisted(() => ({
  config: { repo: '/repo-a' },
  instances: [] as {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    notify: (notice: SyncNotice) => void;
  }[],
  options: [] as RemoteSyncOptions[],
  pullRequests: {},
  worktrees: {},
}));
vi.mock('./repo.js', () => ({
  activeConfigService: () => state.config,
  activeWorktreeService: () => state.worktrees,
}));
vi.mock('./program.js', () => ({ pullRequests: state.pullRequests }));
vi.mock('@n10/engine', () => ({
  EMPTY_SYNC_SNAPSHOT: { lastGitSyncAt: null },
  createRemoteSync: (options: RemoteSyncOptions) => {
    state.options.push(options);
    const instance = {
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      refresh: vi.fn(async () => undefined),
      notify: vi.fn() as (notice: SyncNotice) => void,
      getSnapshot: () => ({ lastGitSyncAt: 42, loading: true }),
      subscribeNotices(listener: (notice: SyncNotice) => void) {
        instance.notify = listener;
        return () => undefined;
      },
    };
    state.instances.push(instance);
    return instance;
  },
}));

beforeEach(() => {
  vi.resetModules();
  state.config = { repo: '/repo-a' };
  state.instances = [];
  state.options = [];
});

it('composes the selected config/cache/removal services and adapts notices', async () => {
  const host = await import('./remote-sync.js');
  const notify = vi.fn();
  host.setSyncNotifier(notify);
  host.startRemoteSyncLoop('/repo-a');
  expect(state.options[0]).toEqual({
    config: state.config,
    pullRequests: state.pullRequests,
    worktrees: state.worktrees,
  });
  expect(state.instances[0].start).toHaveBeenCalledOnce();
  state.instances[0].notify({
    type: 'removed',
    repo: '/repo-a',
    branch: 'topic',
  });
  expect(notify).toHaveBeenCalledWith({
    message: 'Auto-deleted merged branch: topic',
    kind: 'success',
  });
  const error =
    "Couldn't fetch from origin; checking merge status with the provider";
  state.instances[0].notify({ type: 'failed', repo: '/repo-a', error });
  expect(notify).toHaveBeenLastCalledWith({ message: error, kind: 'warning' });
  expect(host.getSyncDecorations('/repo-a').lastGitSyncAt).toBe(42);
});

it('reuses the same scope and stops it when selecting another config handle', async () => {
  const host = await import('./remote-sync.js');
  host.startRemoteSyncLoop('/repo-a');
  host.startRemoteSyncLoop('/repo-a');
  expect(state.instances).toHaveLength(1);
  expect(state.instances[0].start).toHaveBeenCalledTimes(2);
  state.config = { repo: '/repo-b' };
  host.startRemoteSyncLoop('/repo-b');
  expect(state.instances[0].stop).toHaveBeenCalledOnce();
  expect(state.instances).toHaveLength(2);
  await host.refreshRemoteSync();
  expect(state.instances[1].refresh).toHaveBeenCalledOnce();
  await host.stopRemoteSyncLoop();
  expect(state.instances[1].stop).toHaveBeenCalledOnce();
});

it('keeps a parked repository’s last decorations, and the selected one’s live', async () => {
  const host = await import('./remote-sync.js');
  host.startRemoteSyncLoop('/repo-a');
  state.config = { repo: '/repo-b' };
  host.startRemoteSyncLoop('/repo-b');
  // A pass the switch cut short is not still loading.
  expect(host.getSyncDecorations('/repo-a')).toMatchObject({
    lastGitSyncAt: 42,
    loading: false,
  });
  expect(host.getSyncDecorations('/repo-b')).toMatchObject({
    lastGitSyncAt: 42,
    loading: true,
  });
  expect(host.getSyncDecorations('/repo-c').lastGitSyncAt).toBeNull();
});

it('ignores a request for a repository that is no longer selected', async () => {
  const host = await import('./remote-sync.js');
  host.startRemoteSyncLoop('/repo-b');
  expect(state.instances).toHaveLength(0);
});

it('waits for retiring scopes on shutdown as well as the current one', async () => {
  const host = await import('./remote-sync.js');
  host.startRemoteSyncLoop('/repo-a');
  let finish!: () => void;
  state.instances[0].stop.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  state.config = { repo: '/repo-b' };
  host.startRemoteSyncLoop('/repo-b');
  let stopped = false;
  const shutdown = host.stopRemoteSyncLoop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(stopped).toBe(false);
  finish();
  await shutdown;
  expect(stopped).toBe(true);
});

it('names the repository when a retired scope completes a removal', async () => {
  const host = await import('./remote-sync.js');
  const notify = vi.fn();
  host.setSyncNotifier(notify);
  host.startRemoteSyncLoop('/repo-a');
  state.config = { repo: '/repo-b' };
  host.startRemoteSyncLoop('/repo-b');
  state.instances[0].notify({
    type: 'removed',
    repo: '/repo-a',
    branch: 'topic',
  });
  expect(notify).toHaveBeenCalledWith({
    message: 'Auto-deleted merged branch: topic (/repo-a)',
    kind: 'success',
  });
});
