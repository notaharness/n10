import type * as Core from '@n10/core';
import type { TaggedSession } from '@n10/core';
import type { RemoteMachine } from '@n10/terminal-tmux';
import { beforeEach, expect, it, vi } from 'vitest';
import { refuseIfRemoteOwns } from './remote-owner.js';
import type { FleetOwnership } from './remote-owner.js';
import type { MachineView } from './machine-types.js';

const mocks = vi.hoisted(() => ({
  alive: vi.fn(),
  persisted: vi.fn(),
  sessions: vi.fn(),
}));
vi.mock('@n10/core', async (original) => ({
  ...(await original<typeof Core>()),
  isSessionAlive: mocks.alive,
  hasLiveSession: mocks.persisted,
  listOurSessionsWith: mocks.sessions,
}));
const machine = (
  peerId: string,
  extra: Partial<MachineView> = {}
): MachineView => ({
  peerId,
  label: `machine-${peerId}`,
  isLocal: false,
  state: 'connected',
  path: null,
  lastSeenAt: null,
  grant: 'all',
  queued: 0,
  inboundWaiting: [],
  inboundRefused: [],
  ...extra,
});
const session = (extra: Partial<TaggedSession> = {}): TaggedSession =>
  ({
    type: 'worktree',
    repo: '/repo',
    branch: 'feature',
    paneDead: false,
    ...extra,
  } as TaggedSession);
const listMachines = vi.fn();
const machineFor = vi.fn(
  (id: string) => ({ id, executor: {} } as RemoteMachine)
);
const fleet: FleetOwnership = { listMachines, machineFor };
beforeEach(() => {
  vi.resetAllMocks();
  listMachines.mockResolvedValue([machine('peer')]);
  mocks.sessions.mockResolvedValue([session()]);
});
it.each(['alive', 'persisted'] as const)(
  'prefers an existing %s local session',
  async (kind) => {
    mocks[kind].mockReturnValue(true);
    await expect(
      refuseIfRemoteOwns(fleet, '/repo', 'feature', 'local')
    ).resolves.toBeUndefined();
    expect(listMachines).not.toHaveBeenCalled();
  }
);
it('asks only connected non-local machines', async () => {
  listMachines.mockResolvedValue([
    machine('local', { isLocal: true }),
    machine('offline', { state: 'offline' }),
    machine('peer'),
  ]);
  mocks.sessions.mockResolvedValue([]);
  await refuseIfRemoteOwns(fleet, '/repo', 'feature', null);
  expect(machineFor.mock.calls).toEqual([['peer']]);
});
it('names the machine when it refuses a matching live checkout', async () => {
  await expect(
    refuseIfRemoteOwns(fleet, '/repo', 'feature', null)
  ).rejects.toThrow('machine-peer');
});
it('matches repository and branch and ignores dead panes and terminals', async () => {
  mocks.sessions.mockResolvedValue([
    session({ repo: '/other' }),
    session({ branch: 'other' }),
    session({ exited: true }),
    session({ type: 'shell' }),
  ]);
  await expect(
    refuseIfRemoteOwns(fleet, '/repo', 'feature', null)
  ).resolves.toBeUndefined();
});
it('skips a failing list and a failing peer without suppressing a healthy peer', async () => {
  listMachines.mockRejectedValueOnce(new Error('offline'));
  await expect(
    refuseIfRemoteOwns(fleet, '/repo', 'feature', null)
  ).resolves.toBeUndefined();
  listMachines.mockResolvedValue([machine('failed'), machine('healthy')]);
  mocks.sessions
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce([session()]);
  await expect(
    refuseIfRemoteOwns(fleet, '/repo', 'feature', null)
  ).rejects.toThrow('machine-healthy');
});
