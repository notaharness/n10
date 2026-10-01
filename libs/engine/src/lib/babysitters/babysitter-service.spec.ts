import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestInfo } from '@n10/vcs-core';
import type { VcsProvider } from '@n10/vcs-core';
import { createBabysitterService } from './babysitter-service.js';

const state = vi.hoisted(() => ({
  cwd: '/repo',
  lookupWait: async (): Promise<void> => undefined,
  prs: [] as PullRequestInfo[],
  started: [] as {
    prId: number;
    cwd: string;
    getProvider: () => unknown;
    stop: () => void;
    onStatus: (s: unknown) => void;
    onSpawned?: (name: string, cwd: string) => void;
    isCurrent: () => boolean;
  }[],
  adopted: [] as { name: string; repo: string }[],
  stopped: [] as number[],
}));

vi.mock('./pr-babysitter.js', () => ({
  startPrBabysitter: (opts: {
    pr: PullRequestInfo;
    cwd: string;
    getProvider: () => unknown;
    onStatus: (s: unknown) => void;
    onSpawned?: (name: string, cwd: string) => void;
    isCurrent: () => boolean;
  }) => {
    const entry = {
      prId: opts.pr.id,
      cwd: opts.cwd,
      getProvider: opts.getProvider,
      stop: () => state.stopped.push(opts.pr.id),
      onStatus: opts.onStatus,
      onSpawned: opts.onSpawned,
      isCurrent: opts.isCurrent,
    };
    state.started.push(entry);
    return {
      status: () => ({ prId: opts.pr.id, phase: 'watching' }),
      stop: entry.stop,
      pollNow: () => Promise.resolve(),
    };
  },
}));

const pr = (id: number): PullRequestInfo => ({
  id,
  title: `PR ${id}`,
  sourceBranch: `feat/${id}`,
  targetBranch: 'master',
  url: '',
  createdByIdentifier: 'me',
  createdByDisplayName: 'Me',
});

let service: ReturnType<typeof createBabysitterService>;
const mod = {
  startBabysit: (id: number) => service.start(state.cwd, id),
  stopBabysit: (id: number) => service.stop(state.cwd, id),
  babysatStatuses: (repo: string) => service.getSnapshot(repo),
  stopBabysitForBranch: (repo: string, branch: string) =>
    service.stopBranch(repo, branch),
  stopAllBabysitters: () => service.dispose(),
};
const changes: unknown[] = [];

beforeEach(() => {
  state.cwd = '/repo';
  state.lookupWait = async () => undefined;
  state.prs = [pr(7), pr(8)];
  state.started.length = 0;
  state.adopted.length = 0;
  state.stopped.length = 0;
  changes.length = 0;
  service = createBabysitterService({
    config: (repo) => ({
      config: { vendorAuth: {}, vendorProject: {} },
      provider: `provider@${repo}` as unknown as VcsProvider,
    }),
    pullRequests: {
      lookupPullRequest: async (_repo, id) => {
        await state.lookupWait();
        const pr = state.prs.find((entry) => entry.id === id);
        return pr ? { kind: 'found', pr } : { kind: 'gone' };
      },
    },
    paneSize: () => ({ cols: 120, rows: 40 }),
    isCurrent: (repo) => repo === state.cwd,
    isForeignSession: () => false,
    spawned: (name, repo) => {
      state.adopted.push({ name, repo });
    },
  });
  service.subscribe((event) => {
    if (event.type === 'spawned')
      changes.push({ spawned: { prId: event.prId, name: event.name } });
    else if (event.type === 'ended')
      changes.push({
        ended: { prId: event.prId, sourceBranch: event.sourceBranch },
      });
  });
});

describe('babysit service', () => {
  it('starts one babysitter per pull request and lists it', async () => {
    await mod.startBabysit(7);
    await mod.startBabysit(7);
    expect(state.started.map((s) => s.prId)).toEqual([7]);
    // The repository is handed over at start: the host chdir()s when
    // another one is opened, and the watcher's git must not follow.
    expect(state.started[0].cwd).toBe('/repo');
    // The provider is a getter: a vendor switched in Settings has to
    // reach a watcher that started under the previous one.
    expect(state.started[0].getProvider()).toBe('provider@/repo');
    expect(
      [...mod.babysatStatuses(state.cwd).values()].map((s) => s.prId)
    ).toEqual([7]);
    expect(mod.babysatStatuses('/repo').get(7)).toMatchObject({ prId: 7 });
    // Starting is the renderer's own doing; it refetches the sidebar
    // itself, so nothing is pushed.
    expect(changes).toEqual([]);
  });

  it('refuses a pull request the sidebar does not have', async () => {
    await expect(mod.startBabysit(99)).rejects.toThrow('#99');
    expect([...mod.babysatStatuses(state.cwd).values()]).toEqual([]);
  });

  it('stops and forgets, and tolerates stopping nothing', async () => {
    await mod.startBabysit(7);
    mod.stopBabysit(7);
    mod.stopBabysit(7);
    expect(state.stopped).toEqual([7]);
    expect([...mod.babysatStatuses(state.cwd).values()]).toEqual([]);
    expect(mod.babysatStatuses('/repo').size).toBe(0);
  });

  it('drops a babysitter that ended on its own and says which', async () => {
    await mod.startBabysit(7);
    state.started[0].onStatus({ prId: 7, phase: 'ended' });
    expect([...mod.babysatStatuses(state.cwd).values()]).toEqual([]);
    expect(changes.at(-1)).toEqual({
      ended: { prId: 7, sourceBranch: 'feat/7' },
    });
  });

  it('adopts a session the babysitter spawned, under the pull request branch, and says so', async () => {
    await mod.startBabysit(7);
    state.cwd = '/other';
    state.started[0].onSpawned?.('feat-7', '/wt/feat-7');
    expect(state.adopted).toEqual([{ name: 'feat-7', repo: '/repo' }]);
    // A new agent is a sidebar row and a session the renderer's next
    // poll would show seconds late.
    expect(changes).toEqual([{ spawned: { prId: 7, name: 'feat-7' } }]);
  });

  it('pushes nothing for a status that merely moved', async () => {
    await mod.startBabysit(7);
    state.started[0].onStatus({ prId: 7, phase: 'pending' });
    expect(changes).toEqual([]);
  });

  it('keeps babysitters per repository and sits out ticks while another is open', async () => {
    await mod.startBabysit(7);
    state.cwd = '/other';
    state.prs = [pr(7)];
    expect([...mod.babysatStatuses(state.cwd).values()]).toEqual([]);
    expect(mod.babysatStatuses('/repo').size).toBe(1);
    expect(state.started[0].isCurrent()).toBe(false);
    await mod.startBabysit(7);
    expect(state.started).toHaveLength(2);
    expect(state.started[1].cwd).toBe('/other');
    state.cwd = '/repo';
    expect(
      [...mod.babysatStatuses(state.cwd).values()].map((s) => s.prId)
    ).toEqual([7]);
    expect(state.started[0].isCurrent()).toBe(true);
  });

  it('stops the babysitter of a branch whose worktree is being removed', async () => {
    await mod.startBabysit(7);
    await mod.startBabysit(8);
    mod.stopBabysitForBranch('/repo', 'feat/7');
    mod.stopBabysitForBranch('/repo', 'feat/none');
    expect(state.stopped).toEqual([7]);
    expect(
      [...mod.babysatStatuses(state.cwd).values()].map((s) => s.prId)
    ).toEqual([8]);
  });

  it('stops every babysitter of every repository on exit', async () => {
    await mod.startBabysit(7);
    await mod.startBabysit(8);
    mod.stopAllBabysitters();
    expect(state.stopped.sort()).toEqual([7, 8]);
    expect([...mod.babysatStatuses(state.cwd).values()]).toEqual([]);
  });
});

function delayLookup() {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.lookupWait = () => pending;
  return release;
}

it('coalesces concurrent starts while the pull request is still loading', async () => {
  const release = delayLookup();
  const first = service.start('/repo', 7);
  expect(service.start('/repo', 7)).toBe(first);
  release();
  await first;
  expect(state.started).toHaveLength(1);
});

it.each(['stop', 'dispose', 'removal', 'switch'] as const)(
  'does not create a watch after %s interrupts its lookup',
  async (action) => {
    const release = delayLookup();
    const starting = service.start('/repo', 7);
    if (action === 'stop') service.stop('/repo', 7);
    if (action === 'dispose') service.dispose();
    if (action === 'removal') service.stopBranch('/repo', 'feat/7');
    if (action === 'switch') state.cwd = '/other';
    release();
    await expect(starting).rejects.toThrow(/cancelled/);
    expect(state.started).toEqual([]);
  }
);

it('keeps a pending start for a different branch during removal', async () => {
  const release = delayLookup();
  const starting = service.start('/repo', 8);
  service.stopBranch('/repo', 'feat/7');
  release();
  await starting;
  expect(state.started.map((entry) => entry.prId)).toEqual([8]);
});

it('keeps snapshot identity until a watch changes', async () => {
  const empty = service.getSnapshot('/repo');
  expect(service.getSnapshot('/repo')).toBe(empty);
  await service.start('/repo', 7);
  expect(service.getSnapshot('/repo')).not.toBe(empty);
  service.stop('/repo', 7);
  expect(service.getSnapshot('/repo').size).toBe(0);
});

it('ignores a stopped watch ending after a successor starts', async () => {
  await service.start('/repo', 7);
  const stopped = state.started[0];
  service.stop('/repo', 7);
  await service.start('/repo', 7);
  stopped.onStatus({ prId: 7, phase: 'ended' });
  expect(service.getSnapshot('/repo').get(7)).toMatchObject({
    phase: 'watching',
  });
  expect(changes).toEqual([]);
});
