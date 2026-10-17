import type {
  MachineView,
  MachineGrant,
  CeremonyRequest,
  CeremonyProgress,
  CeremonyOutcome,
  FleetResetOutcome,
  InboundMailItem,
} from './machine-types.js';

export interface MachinesPort {
  listMachines(): Promise<MachineView[]>;
  setAlias(peerId: string, alias: string | null): Promise<void>;
  setGrant(peerId: string, grant: MachineGrant): Promise<void>;
  runCeremony(
    request: CeremonyRequest,
    onProgress: (progress: CeremonyProgress) => void
  ): Promise<CeremonyOutcome>;
  cancelCeremony(): Promise<void>;
  resetFleet(): Promise<FleetResetOutcome>;
}

export interface InboundMailPort {
  snapshotFor(peerId: string): {
    inboundWaiting: InboundMailItem[];
    inboundRefused: InboundMailItem[];
  };
  dismiss(id: string): void;
}
