import { beforeEach, describe, expect, it } from 'vitest';
import type { MachineView } from './machine-types.js';
import { createMachineService } from './machine-service.js';
let service: ReturnType<typeof createMachineService>;
function withMailOverlay(machines: MachineView[]) {
  service.receiveMachines(machines);
  return service.getSnapshot().machines;
}

function machine(peerId: string): MachineView {
  return {
    peerId,
    label: peerId,
    isLocal: false,
    state: 'connected',
    path: 'direct',
    lastSeenAt: null,
    grant: 'all',
    queued: 0,
    inboundWaiting: [],
    inboundRefused: [],
  };
}

beforeEach(() => {
  service = createMachineService();
});

describe('withMailOverlay', () => {
  it('leaves machines untouched when no port is installed', () => {
    expect(withMailOverlay([machine('bbbbbbbbbbbbbbbb')])).toEqual([
      machine('bbbbbbbbbbbbbbbb'),
    ]);
  });

  it('overlays each machine with its own snapshot, by peerId', () => {
    service.setMailPort({
      snapshotFor: (peerId: string) =>
        peerId === 'bbbbbbbbbbbbbbbb'
          ? {
              inboundWaiting: [{ id: 'e1', target: 'tmux:x', receivedAt: 1 }],
              inboundRefused: [],
            }
          : { inboundWaiting: [], inboundRefused: [] },
      dismiss: () => undefined,
    });
    const [a, b] = withMailOverlay([
      machine('bbbbbbbbbbbbbbbb'),
      machine('cccccccccccccccc'),
    ]);
    expect(a.inboundWaiting).toHaveLength(1);
    expect(b.inboundWaiting).toEqual([]);
  });
});

describe('dismissInboundMail', () => {
  it('rejects when no port is installed', async () => {
    await expect(service.dismissMail('e1')).rejects.toThrow(/not available/);
  });

  it('forwards to the installed port', async () => {
    const dismissed: string[] = [];
    service.setMailPort({
      snapshotFor: () => ({ inboundWaiting: [], inboundRefused: [] }),
      dismiss: (id: string) => dismissed.push(id),
    });
    await service.dismissMail('e1');
    expect(dismissed).toEqual(['e1']);
  });
});
