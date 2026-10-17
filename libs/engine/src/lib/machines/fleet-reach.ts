import type { FleetStatus, MachineView } from './machine-types.js';

/** The rows as this machine can vouch for them. beam's own `offline`
 *  says only that no tunnel to a peer is up, not which end lost it.
 *  Without a network, as the operating system reports it, this machine
 *  is the one offline. With n10's connection to beam lost
 *  (`restarting`), beam's rows are stale. Either way no peer's state is
 *  known; revocations stand. */
export function asSeenFromHere(
  machines: MachineView[],
  status: FleetStatus,
  online: boolean
): MachineView[] {
  if (online && status.state !== 'restarting') return machines;
  return machines.map((machine) => {
    if (machine.isLocal)
      return online ? machine : { ...machine, state: 'offline' };
    if (machine.state === 'connected' || machine.state === 'offline')
      return { ...machine, state: 'unknown' };
    return machine;
  });
}
