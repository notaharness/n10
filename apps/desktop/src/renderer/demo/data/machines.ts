import type { MachineView } from '../../../host/contract.js';

/**
 * A small beam fleet: this laptop, a desktop at home, and a Mac mini
 * that has been unreachable for a few days with mail queued for it.
 * peerIds are beam's 32 hex digits and the fleet id its 16, randomly
 * generated for the demo.
 */
export const LAPTOP = '206ca2e21d30e3eee40c25347c18574b';
export const DESKTOP = 'a5720899386a6c943b59370a57dbe1ec';
const MAC_MINI = '722d4e44117ea8f7de50ad71889f31e8';
export const FLEET_ID = 'b2226326713a038f';

const DAY = 86_400_000;

/** A machine row, connected directly unless `rest` says otherwise. */
export function member(
  peerId: string,
  label: string,
  rest: Partial<MachineView> = {}
): MachineView {
  return {
    queued: 0,
    inboundWaiting: [],
    inboundRefused: [],
    peerId,
    label,
    isLocal: false,
    state: 'connected',
    path: 'direct',
    lastSeenAt: Date.now() - 4_000,
    grant: 'all',
    ...rest,
  };
}

export const desktop = () => member(DESKTOP, 'Desktop');

export const macMini = () =>
  member(MAC_MINI, 'Mac Mini', {
    state: 'offline',
    path: 'unknown',
    lastSeenAt: Date.now() - 3 * DAY,
    grant: 'msg',
    queued: 2,
  });
