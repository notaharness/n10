import type { BeamStatus, MachineView } from '../../../host/contract.js';

/**
 * A small beam fleet: this laptop, a desktop at home, and a Mac mini
 * that has been offline for a few days with mail queued for it.
 * peerIds are beam's 32 hex digits, randomly generated for the demo.
 */
export const LAPTOP = '206ca2e21d30e3eee40c25347c18574b';
export const DESKTOP = 'a5720899386a6c943b59370a57dbe1ec';
const MAC_MINI = '722d4e44117ea8f7de50ad71889f31e8';

const DAY = 86_400_000;

export function machines(): MachineView[] {
  const now = Date.now();
  const base = {
    queued: 0,
    inboundWaiting: [],
    inboundRefused: [],
  };
  return [
    {
      ...base,
      peerId: LAPTOP,
      label: 'Laptop',
      isLocal: true,
      state: 'connected',
      path: null,
      lastSeenAt: now,
      grant: 'all',
    },
    {
      ...base,
      peerId: DESKTOP,
      label: 'Desktop',
      isLocal: false,
      state: 'connected',
      path: 'direct',
      lastSeenAt: now - 4_000,
      grant: 'all',
    },
    {
      ...base,
      peerId: MAC_MINI,
      label: 'Mac Mini',
      isLocal: false,
      state: 'offline',
      path: 'unknown',
      lastSeenAt: now - 3 * DAY,
      grant: 'msg',
      queued: 2,
    },
  ];
}

export const BEAM_STATUS: BeamStatus = {
  state: 'ready',
  detail: null,
  enrolled: true,
  fleetId: 'b2226326713a038f',
};
