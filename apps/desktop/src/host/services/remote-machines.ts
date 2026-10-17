import { setMachineResolver } from '@n10/core';
import { machines } from './machines.js';
export type { RemoteMachinePort, StreamEventPayload } from '@n10/engine';
export const setRemoteMachinePort = machines.setRemotePort;
export const machineFor = machines.machineFor;

/** Install the engine capability at the core transport boundary. */
export function installMachineResolver(): void {
  setMachineResolver((peerId) => {
    try {
      return machines.machineFor(peerId);
    } catch {
      return undefined;
    }
  });
}
