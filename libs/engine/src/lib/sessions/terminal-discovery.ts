import { log, logError } from '@n10/logger';
import {
  diffScans,
  LOCAL_MACHINE,
  observeRemoteTerminals,
  sessionIdentity,
  sessionNames,
  type DiscoveredTerminal,
  type DiscoveryDelta,
  type DiscoveryScan,
  type TaggedSession,
} from '@n10/core';

/** The machine a registry name lives on. */
export const machineOf = (name: string): string =>
  sessionIdentity(name)?.machine ?? LOCAL_MACHINE;

/** The terminals on `machine` this process holds. Taken before a listing
 *  is asked for: one launched while it was out is not missing from it. */
export function heldTerminals(machine: string): string[] {
  return sessionNames().filter((name) => {
    const identity = sessionIdentity(name);
    return identity?.kind === 'terminal' && identity.machine === machine;
  });
}

/** This machine's terminals gone from a scan, held ones included:
 *  terminal tabs are process-global, so one an earlier repository's
 *  scanner saw is reconciled too. */
export function endedLocalTerminals(
  delta: DiscoveryDelta,
  next: DiscoveryScan,
  before: readonly string[]
): string[] {
  const present = new Set(next.terminals.map((terminal) => terminal.name));
  return [
    ...new Set([
      ...delta.endedTerminals,
      ...before.filter((name) => !present.has(name)),
    ]),
  ].filter((name) => machineOf(name) === LOCAL_MACHINE);
}

export interface MachineScanPorts {
  /** The other machines to list: those the fleet says are connected. */
  machines(): readonly string[];
  /** False once the scanner stopped or its repository is no longer open. */
  live(): boolean;
  isAlive(name: string): boolean;
  isHeld(name: string): boolean;
  retired: ReadonlySet<string>;
  /** Forget attach failures of `machine`'s names its listing lacks. */
  forgetFailures(machine: string, present: ReadonlySet<string>): void;
  /** Whether one of `offered` failed to attach and will be retried. */
  awaitingAttach(offered: readonly DiscoveredTerminal[]): boolean;
  adopt(terminal: DiscoveredTerminal): Promise<boolean>;
  onChanged(delta: DiscoveryDelta): void;
  /** Handed the machine's whole listing. */
  listed?(machine: string, sessions: readonly TaggedSession[]): void;
  /** Told once a listing of the machine succeeded and its terminals
   *  are adopted, none still waiting on a retried attach. */
  scanned?(machine: string): void;
}

const EMPTY_SCAN: DiscoveryScan = {
  worktrees: [],
  stranded: [],
  persisted: new Set(),
  terminals: [],
};

/**
 * Other machines' terminals, each machine listed on its own. A listing
 * goes over the network and may take until its deadline, so it holds
 * back neither this machine's scan nor another machine's: its answer is
 * acted on when it arrives, and a machine is not asked again while one
 * listing there is out. Only a listing that succeeded ends a machine's
 * terminals; one that failed says nothing about them.
 */
export function createMachineScans(ports: MachineScanPorts) {
  const listing = new Set<string>();

  async function scanMachine(machine: string): Promise<void> {
    const before = heldTerminals(machine);
    let terminals: DiscoveredTerminal[];
    try {
      terminals = await observeRemoteTerminals(
        machine,
        ports.listed && ((sessions) => ports.listed?.(machine, sessions))
      );
    } catch (error) {
      log('warn', 'discovery', `could not list ${machine}'s sessions`, {
        error: String(error),
      });
      return;
    }
    if (!ports.live()) return;
    const present = new Set(terminals.map((terminal) => terminal.name));
    ports.forgetFailures(machine, present);
    const delta = diffScans(
      null,
      { ...EMPTY_SCAN, terminals },
      ports.isAlive,
      ports.retired,
      ports.isHeld
    );
    delta.endedTerminals = before.filter((name) => !present.has(name));
    // Attach first, announce second, as the local scan does.
    const adopted = await adoptAll(delta.adoptableTerminals);
    if (adopted === null) return;
    if (ports.live() && !ports.awaitingAttach(delta.adoptableTerminals))
      ports.scanned?.(machine);
    if ((adopted > 0 || delta.endedTerminals.length > 0) && ports.live())
      ports.onChanged({ ...delta, changed: true });
  }

  /** How many of `terminals` attached; null once the scan went stale. */
  async function adoptAll(
    terminals: readonly DiscoveredTerminal[]
  ): Promise<number | null> {
    let adopted = 0;
    for (const terminal of terminals) {
      if (!ports.live()) return null;
      if (await ports.adopt(terminal)) adopted += 1;
    }
    return adopted;
  }

  return {
    /** Ask each machine not already being listed. Never rejects. */
    scan(): Promise<void> {
      const asked = ports.machines().filter((machine) => !listing.has(machine));
      return Promise.all(
        asked.map((machine) => {
          listing.add(machine);
          return scanMachine(machine)
            .catch((error: unknown) => logError('discovery', error))
            .finally(() => listing.delete(machine));
        })
      ).then(() => undefined);
    },
  };
}
