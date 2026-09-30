import { createMachineService } from '@n10/engine';
import type { MachineEvent, MachinesPort } from '@n10/engine';
import type {
  FleetStatus,
  CeremonyProgress,
  DirectoryPublished,
  MachineView,
} from '@n10/engine/contract';

export const machines = createMachineService();
export type { MachinesPort };
export const setMachinesPort = machines.setPort;
export const receiveMachinesUpdate = machines.receiveMachines;
export const receiveBeamStatus = machines.receiveStatus;
export const receiveDirectoryPublished = machines.receiveDirectory;
export const refreshMailOverlay = machines.refreshMail;
export const getLastKnownMachines = () => machines.getSnapshot().machines;
export const getBeamStatus = async () => machines.getSnapshot().status;
export const setMachineAlias = machines.setAlias;
export const setMachineGrant = machines.setGrant;
export const runCeremony = machines.runCeremony;
export const cancelCeremony = machines.cancelCeremony;
export const resetFleet = machines.resetFleet;

export async function listMachines(): Promise<MachineView[]> {
  const snapshot = await machines.refresh();
  if (snapshot.error) throw new Error(snapshot.error);
  return snapshot.machines;
}

let changed: ((value: MachineView[]) => void) | null = null;
let statusChanged: ((value: FleetStatus) => void) | null = null;
let progress: ((value: CeremonyProgress) => void) | null = null;
let directory: ((value: DirectoryPublished) => void) | null = null;
machines.subscribe((event: MachineEvent) => {
  switch (event.type) {
    case 'changed':
      // Read errors return to the IPC caller; they do not change fleet rows.
      break;
    case 'machines':
      changed?.(event.machines);
      break;
    case 'status':
      statusChanged?.(event.status);
      break;
    case 'ceremony':
      progress?.(event.progress);
      break;
    case 'directory':
      directory?.(event.landed);
      break;
  }
});
export function setMachinesNotifier(fn: typeof changed): void {
  changed = fn;
}
export function setBeamStatusNotifier(fn: typeof statusChanged): void {
  statusChanged = fn;
}
export function setCeremonyProgressNotifier(fn: typeof progress): void {
  progress = fn;
}
export function setDirectoryPublishedNotifier(fn: typeof directory): void {
  directory = fn;
}
