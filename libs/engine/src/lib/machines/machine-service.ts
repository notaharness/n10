import { isDeepStrictEqual } from 'node:util';
import { logError } from '@n10/logger';
import { createRemoteMachines } from './remote-machines.js';
import { refuseIfRemoteOwns } from './remote-owner.js';
import type { InboundMailPort, MachinesPort } from './machine-ports.js';
import type {
  MachineView,
  MachineGrant,
  FleetStatus,
  CeremonyRequest,
  CeremonyProgress,
  DirectoryPublished,
} from './machine-types.js';

export interface MachineSnapshot {
  available: boolean;
  machines: MachineView[];
  status: FleetStatus;
  error: string | null;
}
export type MachineEvent =
  | { type: 'changed' }
  | { type: 'machines'; machines: MachineView[] }
  | { type: 'status'; status: FleetStatus }
  | { type: 'ceremony'; progress: CeremonyProgress }
  | { type: 'directory'; landed: DirectoryPublished };
const unavailable: FleetStatus = {
  state: 'unavailable',
  detail: 'Remote machines are not available in this shell',
  enrolled: false,
  fleetId: null,
};

/** Fleet state and policy; adapters supply transport and native process ownership. */
export function createMachineService() {
  const remote = createRemoteMachines();
  let port: MachinesPort | null = null;
  let mail: InboundMailPort | null = null;
  let version = 0;
  let reported: MachineView[] = [];
  let active: Promise<MachineSnapshot> | undefined;
  let snapshot: MachineSnapshot = {
    available: false,
    machines: [],
    status: unavailable,
    error: null,
  };
  const listeners = new Set<(event: MachineEvent) => void>();
  function emit(event: MachineEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        logError('machine observer', error);
      }
    }
  }
  function requirePort(): MachinesPort {
    if (!port) throw new Error('machines are not available yet');
    return port;
  }
  function overlay(machines: MachineView[]): MachineView[] {
    if (!mail) return machines;
    return machines.map((machine) => ({
      ...machine,
      ...mail!.snapshotFor(machine.peerId),
    }));
  }
  function receiveMachines(machines: MachineView[]): void {
    version += 1;
    reported = machines;
    const recovered = snapshot.error !== null;
    if (recovered) {
      snapshot = { ...snapshot, error: null };
      emit({ type: 'changed' });
    }
    publishMachines(recovered);
  }
  function publishMachines(recovered = false): void {
    const machines = overlay(reported);
    if (!recovered && isDeepStrictEqual(machines, snapshot.machines)) return;
    snapshot = { ...snapshot, machines };
    emit({ type: 'machines', machines: snapshot.machines });
  }
  function receiveStatus(status: FleetStatus): void {
    snapshot = { ...snapshot, status };
    emit({ type: 'status', status });
  }
  function refresh(): Promise<MachineSnapshot> {
    if (active) return active;
    const started = version;
    const transport = port;
    const request = Promise.resolve()
      .then(async () => {
        try {
          if (!transport) throw new Error('machines are not available yet');
          const machines = await transport.listMachines();
          if (started === version) receiveMachines(machines);
        } catch (error) {
          if (started === version) {
            snapshot = {
              ...snapshot,
              error: error instanceof Error ? error.message : String(error),
            };
            emit({ type: 'changed' });
          }
        }
        return snapshot;
      })
      .finally(() => {
        if (active === request) active = undefined;
      });
    active = request;
    return request;
  }
  async function listMachines(): Promise<MachineView[]> {
    const value = await refresh();
    if (value.error) throw new Error(value.error);
    return value.machines;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: (event: MachineEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPort(next: MachinesPort | null): void {
      if (next === port) return;
      port = next;
      version += 1;
      active = undefined;
      reported = [];
      const hadMachines = snapshot.machines.length > 0;
      snapshot = {
        available: next !== null,
        machines: [],
        status: next
          ? { ...unavailable, state: 'connecting', detail: null }
          : unavailable,
        error: null,
      };
      if (hadMachines) emit({ type: 'machines', machines: snapshot.machines });
      emit({ type: 'status', status: snapshot.status });
    },
    refresh,
    receiveMachines,
    receiveStatus,
    receiveDirectory(landed: DirectoryPublished): void {
      emit({ type: 'directory', landed });
    },
    setRemotePort: remote.setPort,
    machineFor: remote.machineFor,
    setMailPort(next: InboundMailPort | null): void {
      mail = next;
      publishMachines();
    },
    refreshMail(): void {
      publishMachines();
    },
    async dismissMail(id: string): Promise<void> {
      if (!mail) throw new Error('inbound mail is not available yet');
      mail.dismiss(id);
    },
    async setAlias(peerId: string, alias: string | null): Promise<void> {
      return requirePort().setAlias(peerId, alias);
    },
    async setGrant(peerId: string, grant: MachineGrant): Promise<void> {
      return requirePort().setGrant(peerId, grant);
    },
    async runCeremony(request: CeremonyRequest) {
      return requirePort().runCeremony(request, (progress) =>
        emit({ type: 'ceremony', progress })
      );
    },
    async cancelCeremony() {
      return requirePort().cancelCeremony();
    },
    async resetFleet() {
      return requirePort().resetFleet();
    },
    refuseIfRemoteOwns: (repo: string, branch: string, name: string | null) =>
      refuseIfRemoteOwns(
        { listMachines, machineFor: remote.machineFor },
        repo,
        branch,
        name
      ),
  };
}
