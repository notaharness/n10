import type * as WorktreeManager from '@n10/worktree-manager';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  WorktreeInfo,
  WorktreeScope,
  Machine,
} from '@n10/worktree-manager';
import { createWorktreeService } from './worktree-service.js';
import type { ReadFreshness } from '../kernel/read-freshness.js';

const ports = vi.hoisted(() => ({
  list: vi.fn<(scope: WorktreeScope) => Promise<WorktreeInfo[]>>(),
  branches: vi.fn<(cwd: string) => Promise<string[]>>(),
  all: vi.fn<(cwd: string) => Promise<string[]>>(),
  create:
    vi.fn<(branch: string, scope: WorktreeScope) => Promise<string | null>>(),
  fetch: vi.fn(),
  remove: vi.fn(),
  check: vi.fn(),
  rebase: vi.fn(),
  remoteScope:
    vi.fn<
      (
        repo: string,
        template: string | undefined,
        machine: Machine
      ) => Promise<WorktreeScope>
    >(),
}));
vi.mock('@n10/worktree-manager', async (original) => ({
  ...(await original<typeof WorktreeManager>()),
  listWorktrees: ports.list,
  listBranches: ports.branches,
  listAllBranches: ports.all,
  createWorktree: ports.create,
  rebaseOntoMaster: ports.rebase,
}));
vi.mock('@n10/core', () => ({
  fetchRefs: ports.fetch,
  checkWorktreeRemoval: ports.check,
  removeWorktreeSession: ports.remove,
  remoteWorktreeScope: ports.remoteScope,
  keyForWorktree: (wt: WorktreeInfo, repo: string) =>
    JSON.stringify(['worktree', repo, wt.path]),
}));
vi.mock('@n10/logger', () => ({ logError: vi.fn() }));
const row = { branch: 'topic', path: '/repo/trees/topic', bare: false };
const flush = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness(
  repo = '/repo',
  freshness?: ReadFreshness,
  isCurrent?: () => boolean
) {
  let snapshot = {
    config: {
      vendorAuth: {},
      vendorProject: {},
      worktreePath: 'trees/{session}',
    },
  };
  const listeners = new Set<() => void>();
  const service = createWorktreeService({
    config: {
      repo,
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    freshness,
    isCurrent,
  });
  return {
    service,
    listeners,
    configure(template: string) {
      snapshot = { config: { ...snapshot.config, worktreePath: template } };
      for (const listener of listeners) listener();
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  ports.list.mockReset().mockResolvedValue([row]);
  ports.branches.mockReset().mockResolvedValue(['main', 'topic']);
  ports.all.mockReset().mockResolvedValue(['main', 'topic', 'remote-topic']);
  ports.create.mockReset().mockResolvedValue(row.path);
  ports.fetch.mockReset().mockResolvedValue(true);
  ports.remove.mockReset().mockResolvedValue('removed');
  ports.check.mockReset().mockResolvedValue({ verdict: 'clear' });
  ports.rebase.mockReset().mockResolvedValue('success');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('worktree resources', () => {
  it('shares one scoped read between consumers and preserves cached snapshot identity', async () => {
    const { service } = harness();
    const first = service.read();
    expect(service.read()).toBe(first);
    const snapshot = await first;
    expect(snapshot).toMatchObject({
      worktrees: [row],
      branches: ['main', 'topic'],
      allBranches: ['main', 'topic', 'remote-topic'],
      loading: false,
      error: null,
    });
    expect(await service.read()).toBe(snapshot);
    expect(ports.list).toHaveBeenCalledOnce();
    expect(ports.list.mock.calls[0][0].cwd).toBe('/repo');
    expect(ports.list.mock.calls[0][0].resolver.base()).toBe('/repo/trees');
    expect(ports.branches).toHaveBeenCalledWith('/repo');
    expect(ports.all).toHaveBeenCalledWith('/repo');
    vi.setSystemTime(Date.now() + 1_001);
    await service.read();
    expect(ports.list).toHaveBeenCalledTimes(2);
  });
  it('serves a parked repository what it holds, reading behind it past the parked TTL', async () => {
    let parked = false;
    const { service } = harness('/repo', {
      parked: () => parked,
      parkedTtl: 3_600_000,
    });
    const held = await service.read();
    parked = true;
    vi.setSystemTime(Date.now() + 60_000);
    expect(await service.read()).toBe(held);
    expect(ports.list).toHaveBeenCalledOnce();
    vi.setSystemTime(Date.now() + 3_600_000);
    ports.list.mockResolvedValue([row, { ...row, branch: 'next' }]);
    expect((await service.read()).worktrees).toBe(held.worktrees);
    expect(ports.list).toHaveBeenCalledTimes(2);
    await flush();
    expect(service.getSnapshot().worktrees).toHaveLength(2);
  });
  it('answers a parked read with what it holds after a failed refresh', async () => {
    let parked = false;
    const { service } = harness('/repo', {
      parked: () => parked,
      parkedTtl: 3_600_000,
    });
    await service.read();
    ports.list.mockRejectedValueOnce(new Error('Git unavailable'));
    await service.refresh();
    parked = true;
    // Warm: answered from what it holds, the error left for observers.
    expect(await service.read()).toMatchObject({
      worktrees: [row],
      allBranches: ['main', 'topic', 'remote-topic'],
      error: null,
    });
    expect(service.getSnapshot().error).toMatch(/Git unavailable/);
    expect(ports.list).toHaveBeenCalledTimes(2);
  });
  it('coalesces explicit refreshes into one follow-up, without queuing ordinary readers', async () => {
    const a = deferred<WorktreeInfo[]>(),
      b = deferred<WorktreeInfo[]>();
    ports.list.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { service } = harness();
    const active = service.read();
    expect(service.read()).toBe(active);
    expect(service.refresh()).toBe(active);
    expect(service.refresh()).toBe(active);
    a.resolve([row]);
    await flush();
    expect(ports.list).toHaveBeenCalledTimes(2);
    b.resolve([]);
    expect((await active).worktrees).toEqual([]);
    expect(ports.list).toHaveBeenCalledTimes(2);
  });
  it('retains known checkouts on a failed read and clears the error after recovery', async () => {
    const { service } = harness();
    await service.read();
    ports.list.mockRejectedValueOnce(new Error('Git unavailable'));
    expect(await service.refresh()).toMatchObject({
      worktrees: [row],
      error: 'Could not read worktrees and branches: Git unavailable',
      loading: false,
    });
    expect((await service.refresh()).error).toBeNull();
  });
  it('reports the Git reason without exposing the command line', async () => {
    const { service } = harness();
    ports.list.mockRejectedValueOnce(
      new Error(
        'Command failed: git worktree list --porcelain -z\nfatal: repository unavailable\n'
      )
    );
    expect((await service.read()).error).toBe(
      'Could not read worktrees and branches: fatal: repository unavailable'
    );
  });
  it('applies path edits immediately and cannot publish the read using the old template', async () => {
    const a = deferred<WorktreeInfo[]>(),
      b = deferred<WorktreeInfo[]>();
    ports.list.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { service, configure } = harness();
    const notifications = vi.fn();
    service.subscribe(notifications);
    const active = service.read();
    configure('other/{session}');
    a.resolve([row]);
    await flush();
    expect(service.getSnapshot().worktrees).toEqual([]);
    expect(ports.list.mock.calls[0][0].resolver.base()).toBe('/repo/trees');
    expect(ports.list.mock.calls[1][0].resolver.base()).toBe('/repo/other');
    const next = { ...row, path: '/repo/other/topic' };
    b.resolve([next]);
    await active;
    expect(service.getSnapshot().worktrees).toEqual([next]);
    expect(notifications).toHaveBeenCalled();
  });
});

describe('worktree commands', () => {
  it('refuses to change a parked repository’s checkouts or refs', async () => {
    const { service } = harness('/repo', undefined, () => false);
    const approved = { verdict: 'clear' } as never;
    for (const write of [
      () => service.create('topic'),
      () => service.remove('topic', approved),
      () => service.rebase({ branch: 'topic' }),
      () => service.fetchBranches(),
      () => service.resolve({ branch: 'topic' }),
    ])
      await expect(write()).rejects.toThrow('not open');
    expect(ports.create).not.toHaveBeenCalled();
    expect(ports.remove).not.toHaveBeenCalled();
    expect(ports.rebase).not.toHaveBeenCalled();
    expect(ports.fetch).not.toHaveBeenCalled();
    // Reads still answer.
    expect((await service.read()).worktrees).toEqual([row]);
  });
  it('creates under the captured template and refreshes shared resources after success', async () => {
    const { service, configure } = harness();
    const pending = deferred<string | null>();
    ports.create.mockReturnValueOnce(pending.promise);
    const created = service.create('topic');
    configure('elsewhere/{branch}');
    pending.resolve(row.path);
    await created;
    const at = ports.create.mock.calls[0][1];
    expect(at.cwd).toBe('/repo');
    expect(at.resolver.dir('topic')).toBe('trees/topic');
    expect(ports.list).toHaveBeenCalled();
    expect(ports.list.mock.calls.at(-1)![0].resolver.dir('topic')).toBe(
      'elsewhere/topic'
    );
  });
  it('reports a refused creation and never publishes a successful refresh for it', async () => {
    const { service } = harness();
    ports.create.mockResolvedValueOnce(null);
    await expect(service.create('bad')).rejects.toThrow(
      'Failed to create a worktree'
    );
    expect(ports.list).not.toHaveBeenCalled();
  });
  it('resolves an existing checkout by session identity even after its branch changes', async () => {
    const { service } = harness();
    ports.list.mockResolvedValue([{ ...row, branch: 'renamed' }]);
    expect(
      await service.resolve({
        session: JSON.stringify(['worktree', '/repo', row.path]),
      })
    ).toBe(row.path);
    expect(await service.resolve({ session: 'missing' })).toBeNull();
    expect(ports.create).not.toHaveBeenCalled();
  });
  it('ensures the branch checkout for PR targets using the shared idempotent primitive', async () => {
    const { service } = harness();
    expect(await service.resolve({ branch: 'topic' })).toBe(row.path);
    expect(ports.create).toHaveBeenCalledWith(
      'topic',
      expect.objectContaining({ cwd: '/repo' })
    );
  });
  it('refreshes branch resources only after a successful explicit fetch', async () => {
    const { service } = harness();
    ports.fetch.mockResolvedValueOnce(false);
    await expect(service.fetchBranches()).rejects.toThrow('Failed to fetch');
    expect(ports.list).not.toHaveBeenCalled();
    await service.fetchBranches();
    expect(ports.fetch).toHaveBeenCalledWith({ cwd: '/repo', refs: 'all' });
    expect(ports.all).toHaveBeenCalledOnce();
  });
  it('rebases the actual checkout and invalidates its resource', async () => {
    const { service } = harness();
    expect(await service.rebase({ branch: 'topic' })).toBe('success');
    expect(ports.rebase).toHaveBeenCalledWith(row.path, undefined);
    expect(ports.all).toHaveBeenCalledOnce();
    await expect(service.rebase({ branch: 'missing' })).rejects.toThrow(
      'No worktree'
    );
  });
  it('creates a remote checkout in that machine’s clone without refreshing local resources', async () => {
    const { service } = harness('/home/hisuser/repo');
    const machine = { id: 'peer' } as Machine;
    const remote = {
      cwd: '/home/otheruser/repo',
      machine,
    } as unknown as WorktreeScope;
    ports.remoteScope.mockResolvedValueOnce(remote);
    await service.create('topic', machine);
    expect(ports.remoteScope).toHaveBeenCalledWith(
      '/home/hisuser/repo',
      'trees/{session}',
      machine
    );
    expect(ports.create).toHaveBeenCalledWith('topic', remote);
    expect(ports.list).not.toHaveBeenCalled();
  });
});
