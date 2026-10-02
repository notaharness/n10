import type * as Core from '@n10/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FleetStatus,
  CeremonyProgress,
  MachineView,
} from './machine-types.js';
import { createMachineService } from './machine-service.js';
import type { MachinesPort } from './machine-ports.js';
const reachability = vi.hoisted(() => [] as [string, boolean][]);
vi.mock('@n10/core', async (original) => ({
  ...(await original<typeof Core>()),
  setMachineReachable: (id: string, reachable: boolean) =>
    reachability.push([id, reachable]),
}));
let service: ReturnType<typeof createMachineService>;

const PEER = 'b'.repeat(32);

function localMachine(): MachineView {
  return {
    peerId: 'a'.repeat(32),
    label: 'my-mac',
    isLocal: true,
    state: 'connected',
    path: null,
    lastSeenAt: null,
    grant: 'all',
    queued: 0,
    inboundWaiting: [],
    inboundRefused: [],
  };
}

const PROGRESS: CeremonyProgress = { kind: 'stage', stage: 'publishing' };

function fakePort(): MachinesPort & { calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  const record =
    <A extends unknown[], R>(name: string, impl: (...args: A) => R) =>
    (...args: A): R => {
      calls.push([name, args]);
      return impl(...args);
    };
  return {
    calls,
    listMachines: record('listMachines', () =>
      Promise.resolve([localMachine()])
    ),
    setAlias: record('setAlias', () => Promise.resolve()),
    setGrant: record('setGrant', () => Promise.resolve()),
    runCeremony: (request, onProgress) => {
      calls.push(['runCeremony', [request]]);
      onProgress(PROGRESS);
      return Promise.resolve({
        ok: true as const,
        op: 'revoke' as const,
        peerId: PEER,
        published: true,
        acknowledgedBy: 1,
      });
    },
    cancelCeremony: record('cancelCeremony', () => Promise.resolve()),
    resetFleet: record('resetFleet', () => Promise.resolve({ ok: true })),
  };
}

beforeEach(() => {
  service = createMachineService();
  reachability.length = 0;
});

describe('without a port installed', () => {
  it('every call rejects with a clear reason instead of hanging', async () => {
    await expect(service.refresh()).resolves.toMatchObject({
      available: false,
      error: expect.stringMatching(/not available/),
    });
    await expect(service.setGrant(PEER, 'none')).rejects.toThrow(
      /not available/
    );
  });
});

describe('with a port installed', () => {
  it('forwards every call to the port, arguments untouched', async () => {
    const port = fakePort();
    service.setPort(port);

    expect((await service.refresh()).machines).toEqual([localMachine()]);
    await service.setAlias(PEER, 'workbox');
    await service.setAlias(PEER, null);
    await service.setGrant(PEER, 'msg');
    await service.runCeremony({ op: 'revoke', peerId: PEER });
    await service.cancelCeremony();

    expect(port.calls).toEqual([
      ['listMachines', []],
      ['setAlias', [PEER, 'workbox']],
      ['setAlias', [PEER, null]],
      ['setGrant', [PEER, 'msg']],
      ['runCeremony', [{ op: 'revoke', peerId: PEER }]],
      ['cancelCeremony', []],
    ]);
  });

  it('pushes a running ceremony’s progress and resolves with its outcome', async () => {
    service.setPort(fakePort());
    const seen: CeremonyProgress[] = [];
    service.subscribe((event) => {
      if (event.type === 'ceremony') seen.push(event.progress);
    });
    await expect(
      service.runCeremony({ op: 'revoke', peerId: PEER })
    ).resolves.toMatchObject({ ok: true, op: 'revoke' });
    expect(seen).toEqual([PROGRESS]);
  });
});

// Its sessions learn from the fleet, not from a listing that may hang.
describe('a peer going offline and back', () => {
  const peer = (state: MachineView['state']): MachineView => ({
    ...localMachine(),
    peerId: PEER,
    label: 'workbox',
    isLocal: false,
    state,
  });

  it('tells its sessions of each change, and only of changes', () => {
    service.receiveMachines([localMachine(), peer('connected')]);
    service.receiveMachines([localMachine(), peer('connected')]);
    service.receiveMachines([localMachine(), peer('offline')]);
    service.receiveMachines([localMachine(), peer('offline')]);
    service.receiveMachines([localMachine(), peer('connected')]);
    expect(reachability).toEqual([
      [PEER, false],
      [PEER, true],
    ]);
  });

  it('tells them of a peer first heard of offline', () => {
    service.receiveMachines([peer('offline')]);
    expect(reachability).toEqual([[PEER, false]]);
  });
});

describe('the push channel', () => {
  it('calls the installed notifier with exactly what it receives', () => {
    const seen: MachineView[][] = [];
    service.subscribe((event) => {
      if (event.type === 'machines') seen.push(event.machines);
    });
    service.receiveMachines([localMachine()]);
    expect(seen).toEqual([[localMachine()]]);
  });

  it('caches the last update for getLastKnownMachines, with no notifier required', () => {
    service.receiveMachines([localMachine()]);
    expect(service.getSnapshot().machines).toEqual([localMachine()]);
  });

  it('listMachines() also refreshes the cache, for a caller that only reads', async () => {
    service.setPort(fakePort());
    await expect(service.listMachines()).resolves.toEqual([localMachine()]);
    expect(service.getSnapshot().machines).toEqual([localMachine()]);
  });

  it('pushes and answers the latest beam status', async () => {
    const ready: FleetStatus = {
      state: 'ready',
      detail: null,
      enrolled: true,
      fleetId: 'f'.repeat(64),
    };
    const seen: FleetStatus[] = [];
    service.subscribe((event) => {
      if (event.type === 'status') seen.push(event.status);
    });
    service.receiveStatus(ready);
    expect(seen).toEqual([ready]);
    expect(service.getSnapshot().status).toEqual(ready);
  });
});

it('coalesces reads and preserves a newer pushed fleet over an older response', async () => {
  const port = fakePort();
  let finish!: (value: MachineView[]) => void;
  port.listMachines = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  service.setPort(port);
  const reading = service.refresh();
  expect(service.refresh()).toBe(reading);
  await Promise.resolve();
  const pushed = [{ ...localMachine(), label: 'newer' }];
  service.receiveMachines(pushed);
  finish([localMachine()]);
  expect((await reading).machines).toEqual(pushed);
});

it('rejects a late result from a replaced port without hiding the new capability', async () => {
  const port = fakePort();
  let finish!: (value: MachineView[]) => void;
  port.listMachines = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  service.setPort(port);
  const reading = service.refresh();
  await Promise.resolve();
  service.setPort(null);
  const unavailable = service.getSnapshot();
  finish([localMachine()]);
  expect(await reading).toBe(unavailable);
  expect(unavailable).toMatchObject({
    available: false,
    machines: [],
    status: { state: 'unavailable' },
  });
});

it('retains the fleet on refresh failure but rejects a requested machine list', async () => {
  const port = fakePort();
  service.setPort(port);
  await service.refresh();
  port.listMachines = async () => {
    throw new Error('Connection lost');
  };
  const events: unknown[] = [];
  service.subscribe((event) => events.push(event));
  await expect(service.refresh()).resolves.toMatchObject({
    machines: [localMachine()],
    error: 'Connection lost',
  });
  expect(events).toContainEqual({ type: 'changed' });
  await expect(service.listMachines()).rejects.toThrow('Connection lost');
  expect(service.getSnapshot().machines).toEqual([localMachine()]);
});

it('publishes an empty recovered fleet so subscribers clear a startup error', async () => {
  const port = fakePort();
  port.listMachines = async () => {
    throw new Error('beam is not connected');
  };
  service.setPort(port);
  await service.refresh();
  const seen: MachineView[][] = [];
  service.subscribe((event) => {
    if (event.type === 'machines') seen.push(event.machines);
  });
  service.receiveMachines([]);
  expect(service.getSnapshot().error).toBeNull();
  expect(seen).toEqual([[]]);
});
