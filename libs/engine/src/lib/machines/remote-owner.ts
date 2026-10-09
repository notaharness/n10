import { hasLiveSession, isSessionAlive, listOurSessionsWith } from '@n10/core';
import type { RemoteMachine } from '@n10/terminal-tmux';
import type { MachineView } from './machine-types.js';

export interface FleetOwnership {
  listMachines(): Promise<MachineView[]>;
  machineFor(peerId: string): RemoteMachine;
}

/** Prefer an existing local agent; otherwise refuse a duplicate on a connected peer. */
export async function refuseIfRemoteOwns(
  fleet: FleetOwnership,
  repo: string,
  branch: string,
  name: string | null
): Promise<void> {
  if (name && (isSessionAlive(name) || hasLiveSession(name))) return;
  let machines: MachineView[];
  try {
    machines = await fleet.listMachines();
  } catch {
    return;
  }
  for (const machine of machines) {
    if (machine.isLocal || machine.state !== 'connected') continue;
    const owns = await ownsBranch(fleet, machine.peerId, repo, branch);
    if (owns)
      throw new Error(
        `An agent for ${branch} is already running on ${machine.label}. Open it there instead of starting a second one here.`
      );
  }
}

async function ownsBranch(
  fleet: FleetOwnership,
  peerId: string,
  repo: string,
  branch: string
): Promise<boolean> {
  try {
    const sessions = await listOurSessionsWith(
      fleet.machineFor(peerId).executor,
      peerId
    );
    return sessions.some(
      (session) =>
        session.type === 'worktree' &&
        session.repo === repo &&
        session.branch === branch &&
        !session.exited
    );
  } catch {
    return false;
  }
}
