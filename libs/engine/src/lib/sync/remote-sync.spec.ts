import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Core from '@n10/core';
import type { VcsProvider } from '@n10/vcs-core';
import type { RemoteSync, RemoteSyncOptions } from './remote-sync.js';
import type { SyncNotice } from './sync-snapshot.js';

type Sweep = Parameters<typeof Core.sweepMergedBranches>[0];
const verdict = {
  verdict: 'clear',
  tip: 'abc',
  repo: '/repo/.git',
  checkout: '/repo/wt',
} as const;
const env = vi.hoisted(() => ({
  pending: [] as { resolve(value: number): void; reject(error: Error): void }[],
  synced: [] as string[],
  listed: [] as string[],
  swept: [] as string[],
  branches: ['feature/a', 'feature/b', ''],
  merged: new Set<string>(),
  conflicts: new Map<string, number>(),
  compared: [] as unknown[][],
  autoDelete: false,
  beforeRemoval: (() => undefined) as () => void,
  failSweep: false,
  warning: false,
  warned: [] as ReadonlySet<string>[],
}));
vi.mock('./sync-interval.js', () => ({
  remoteSyncIntervalMs: (value: number) => value,
}));
vi.mock('@n10/core', () => ({
  syncRemote: (repo: string) => {
    env.synced.push(repo);
    return new Promise<number>((resolve, reject) =>
      env.pending.push({ resolve, reject })
    );
  },
  sweepMergedBranches: async (options: Sweep) => {
    env.swept.push(options.cwd!);
    env.warned.push(options.warnedRebase);
    if (env.failSweep) throw new Error('Provider unavailable');
    if (env.autoDelete) {
      env.beforeRemoval();
      await options.onAutoDelete('feature/a', verdict);
    }
    if (env.warning) options.onRebaseInProgress('feature/b');
    return { merged: env.merged, nextWarned: new Set(['feature/b']) };
  },
  computeConflictCounts: (...args: unknown[]) => {
    env.compared.push(args);
    return Promise.resolve(env.conflicts);
  },
}));
vi.mock('@n10/logger', () => ({ logError: vi.fn() }));

const { createRemoteSync } = await import('./remote-sync.js');
const services: RemoteSync[] = [];
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function harness(repo = '/repo-a') {
  let config = {
    config: { vendorAuth: {}, vendorProject: {}, mergePollInterval: 1_000 },
    provider: { id: 'github' } as VcsProvider,
    vcsConfigured: true,
    syncRevision: 0,
  };
  const listeners = new Set<() => void>();
  const prMap = { 'feature/a': null };
  const remove = vi.fn<RemoteSyncOptions['worktrees']['remove']>(
    async () => 'removed'
  );
  const sync = createRemoteSync({
    config: {
      repo,
      getSnapshot: () => config,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    pullRequests: {
      getSnapshot: () => ({
        prMap,
        refreshing: false,
        fetchedAt: null,
        error: null,
      }),
    },
    worktrees: {
      remove,
      refresh: async () => {
        env.listed.push(repo);
        return {
          worktrees: env.branches.map((branch) => ({
            branch,
            path: '/wt/' + branch,
            bare: false,
          })),
          branches: [],
          allBranches: [],
          loading: false,
          error: null,
        };
      },
    },
  });
  services.push(sync);
  const notices: SyncNotice[] = [];
  sync.subscribeNotices((notice) => notices.push(notice));
  return {
    sync,
    remove,
    notices,
    prMap,
    configure(patch: Partial<typeof config>) {
      config = { ...config, ...patch };
      for (const listener of listeners) listener();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  env.pending = [];
  env.synced = [];
  env.listed = [];
  env.swept = [];
  env.merged = new Set();
  env.conflicts = new Map();
  env.compared = [];
  env.autoDelete = false;
  env.beforeRemoval = () => undefined;
  env.failSweep = false;
  env.warning = false;
  env.warned = [];
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  vi.useRealTimers();
});
async function complete(index = env.pending.length - 1, timestamp = 1_000) {
  env.pending[index].resolve(timestamp);
  await flush();
}

describe('bounded scheduling', () => {
  it('starts one schedule when the same scope is reopened', async () => {
    const { sync } = harness();
    sync.start();
    sync.start();
    env.pending[0].resolve(1);
    await flush();
    expect(env.synced).toEqual(['/repo-a']);
    vi.advanceTimersByTime(1_000);
    expect(env.synced).toEqual(['/repo-a', '/repo-a']);
    env.pending[1].resolve(2);
    await flush();
  });

  it('skips busy timer ticks without creating a backlog', async () => {
    const { sync } = harness();
    sync.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(env.synced).toEqual(['/repo-a']);
    await complete();
    expect(env.pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(env.pending).toHaveLength(2);
  });

  it('joins concurrent manual refreshes and queues exactly one follow-up', async () => {
    const { sync } = harness();
    const first = sync.refresh();
    const second = sync.refresh();
    expect(second).toBe(first);
    for (let i = 0; i < 20; i++) expect(sync.refresh()).toBe(first);
    await complete(0);
    expect(env.pending).toHaveLength(2);
    await complete(1, 2_000);
    await expect(first).resolves.toBeUndefined();
    expect(env.pending).toHaveLength(2);
    expect(sync.getSnapshot().lastGitSyncAt).toBe(2_000);
  });

  it('restarts on a config sync revision and rearms its interval', async () => {
    const { sync, configure } = harness();
    sync.start();
    await complete();
    await vi.advanceTimersByTimeAsync(400);
    configure({ syncRevision: 1 });
    expect(env.pending).toHaveLength(2);
    await complete();
    await vi.advanceTimersByTimeAsync(600);
    expect(env.pending).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(400);
    expect(env.pending).toHaveLength(3);
    await sync.stop();
    configure({ syncRevision: 2 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(env.pending).toHaveLength(3);
  });

  it('does not restart for unrelated config notifications', async () => {
    const { sync, configure } = harness();
    sync.start();
    await complete();
    configure({
      config: { vendorAuth: {}, vendorProject: {}, mergePollInterval: 1_000 },
    });
    expect(env.pending).toHaveLength(1);
  });

  it('does no Git work and keeps snapshot identity without a configured provider', async () => {
    const { sync, configure } = harness();
    configure({ vcsConfigured: false });
    const before = sync.getSnapshot();
    await sync.refresh();
    expect(env.pending).toHaveLength(0);
    expect(sync.getSnapshot()).toBe(before);
  });
});

describe('scoped state and cancellation', () => {
  it('names the captured repo at every step and excludes merged and detached branches from conflicts', async () => {
    const { sync, prMap } = harness();
    env.merged = new Set(['feature/a']);
    env.conflicts = new Map([['feature/b', 2]]);
    sync.start();
    await complete();
    expect(env.listed).toEqual(['/repo-a']);
    expect(env.swept).toEqual(['/repo-a']);
    expect(env.compared).toEqual([[['feature/b'], prMap, '/repo-a']]);
    expect(sync.getSnapshot()).toMatchObject({
      merged: env.merged,
      conflicts: env.conflicts,
      lastGitSyncAt: 1_000,
      loading: false,
      error: null,
    });
  });

  it('cancels before sweep/removal and lets a different repo start immediately', async () => {
    const first = harness('/repo-a');
    first.sync.start();
    await first.sync.stop();
    const second = harness('/repo-b');
    second.sync.start();
    await complete(0);
    expect(env.swept).toEqual([]);
    await complete(1);
    expect(env.swept).toEqual(['/repo-b']);
    expect(first.sync.getSnapshot().lastGitSyncAt).toBeNull();
    expect(second.sync.getSnapshot().lastGitSyncAt).toBe(1_000);
  });

  it('continues the guarded provider sweep after a failed fetch and recovers', async () => {
    const { sync, remove, notices } = harness();
    env.merged = new Set(['feature/a']);
    sync.start();
    await complete();
    env.merged = new Set(['feature/b']);
    env.conflicts = new Map([['feature/a', 2]]);
    env.autoDelete = true;
    const request = sync.refresh();
    env.pending[1].reject(new Error('Offline'));
    await expect(request).resolves.toBeUndefined();
    expect(sync.getSnapshot()).toMatchObject({
      merged: env.merged,
      conflicts: env.conflicts,
      lastGitSyncAt: 1_000,
      error:
        "Couldn't fetch from origin; checking merge status with the provider",
      loading: false,
    });
    expect(env.swept).toEqual(['/repo-a', '/repo-a']);
    expect(remove).toHaveBeenCalledExactlyOnceWith('feature/a', verdict);
    expect(notices).toContainEqual({
      type: 'failed',
      repo: '/repo-a',
      error:
        "Couldn't fetch from origin; checking merge status with the provider",
    });
    const recovery = sync.refresh();
    await complete(2, 2_000);
    await recovery;
    expect(sync.getSnapshot()).toMatchObject({
      error: null,
      lastGitSyncAt: 2_000,
    });
  });

  it('does not publish success or remove anything when the provider fails', async () => {
    const { sync, remove } = harness();
    env.failSweep = true;
    sync.start();
    await complete();
    expect(remove).not.toHaveBeenCalled();
    expect(sync.getSnapshot()).toMatchObject({
      lastGitSyncAt: null,
      error: 'Provider unavailable',
    });
  });

  it('cancels a stale pass when config restarts it, preserving existing badges', async () => {
    const { sync, configure, remove } = harness();
    env.merged = new Set(['feature/a']);
    sync.start();
    await complete();
    const previous = sync.getSnapshot().merged;
    void sync.refresh();
    configure({ syncRevision: 1, vcsConfigured: false });
    env.autoDelete = true;
    await complete(1);
    expect(remove).not.toHaveBeenCalled();
    expect(sync.getSnapshot().merged).toBe(previous);
    expect(sync.getSnapshot().loading).toBe(false);
  });

  it('does not let observer exceptions reject a read', async () => {
    const { sync } = harness();
    sync.subscribe(() => {
      throw new Error('Broken renderer');
    });
    sync.subscribeNotices(() => {
      throw new Error('Broken toast');
    });
    const request = sync.refresh();
    env.pending[0].reject(new Error('Offline'));
    await expect(request).resolves.toBeUndefined();
    expect(sync.getSnapshot().error).toBe(
      "Couldn't fetch from origin; checking merge status with the provider"
    );
  });
});

describe('guarded removal and notices', () => {
  it.each(['removed', 'kept-branch'] as const)(
    'reports %s only after the captured command completes',
    async (outcome) => {
      const { sync, remove, notices } = harness();
      env.autoDelete = true;
      remove.mockResolvedValue(outcome);
      sync.start();
      await complete();
      expect(remove).toHaveBeenCalledExactlyOnceWith('feature/a', verdict);
      expect(notices).toEqual([
        { type: outcome, branch: 'feature/a', repo: '/repo-a' },
      ]);
    }
  );

  it('says nothing when the guarded removal keeps the checkout', async () => {
    const { sync, remove, notices } = harness();
    env.autoDelete = true;
    remove.mockResolvedValue('changed');
    sync.start();
    await complete();
    expect(notices).toEqual([]);
  });

  it('waits for a started removal and reports its completion after stop', async () => {
    const { sync, remove, notices } = harness();
    env.autoDelete = true;
    let finish!: (value: 'removed') => void;
    remove.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    sync.start();
    await complete();
    expect(remove).toHaveBeenCalledOnce();
    let stopped = false;
    const stopping = sync.stop().then(() => {
      stopped = true;
    });
    await flush();
    expect(stopped).toBe(false);
    finish('removed');
    await stopping;
    await flush();
    expect(notices).toEqual([
      { type: 'removed', branch: 'feature/a', repo: '/repo-a' },
    ]);
    expect(env.compared).toEqual([]);
  });

  it('cancels between the asynchronous verdict and the removal command', async () => {
    const { sync, remove } = harness();
    env.autoDelete = true;
    env.beforeRemoval = () => {
      void sync.stop();
    };
    sync.start();
    await complete();
    expect(env.swept).toEqual(['/repo-a']);
    expect(remove).not.toHaveBeenCalled();
  });

  it('carries rebase-warning history into the next sweep', async () => {
    const { sync, notices } = harness();
    env.warning = true;
    sync.start();
    await complete();
    expect(notices).toContainEqual({
      type: 'rebase-in-progress',
      repo: '/repo-a',
      branch: 'feature/b',
    });
    void sync.refresh();
    await complete();
    expect(env.warned[1]).toEqual(new Set(['feature/b']));
  });
});
