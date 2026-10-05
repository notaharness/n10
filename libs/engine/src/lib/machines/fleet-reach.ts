import type { FleetStatus, MachineView } from './machine-types.js';

/** Whether this machine is cut off from its fleet: its beam daemon's
 *  connection was lost (`restarting`), so beam's rows are stale, or the
 *  operating system reports no network. beam's own `offline` cannot
 *  tell: it says only that no tunnel to a peer is up. */
export function isCutOff(status: FleetStatus, online: boolean): boolean {
  return !online || status.state === 'restarting';
}

/** The rows as this machine can vouch for them. Cut off, this machine is
 *  the one offline and no peer's state is known; revocations stand. */
export function asSeenFromHere(
  machines: MachineView[],
  cutOff: boolean
): MachineView[] {
  if (!cutOff) return machines;
  return machines.map((machine) => {
    if (machine.isLocal) return { ...machine, state: 'offline' };
    if (machine.state === 'connected' || machine.state === 'offline')
      return { ...machine, state: 'unknown' };
    return machine;
  });
}
