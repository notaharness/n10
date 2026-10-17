/** Public domain surface; neighboring domains import this entry. */
export { createMachineService } from './machine-service.js';
export type { MachineEvent, MachineSnapshot } from './machine-service.js';
export type { MachinesPort, InboundMailPort } from './machine-ports.js';
export type {
  RemoteMachinePort,
  StreamEventPayload,
} from './remote-machines.js';
