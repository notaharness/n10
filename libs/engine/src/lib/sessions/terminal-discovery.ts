import { log } from '@n10/logger';
import {
  observeRemoteTerminals,
  sessionIdentity,
  sessionNames,
  type DiscoveredTerminal,
  type DiscoveryDelta,
  type DiscoveryScan,
} from '@n10/core';

/** What discovery saw of other machines' terminals: those it listed, and
 *  the machines it could list. */
export interface RemoteTerminalObservation {
  terminals: DiscoveredTerminal[];
  listed: string[];
}

/** Each machine's terminals, listed at once. A machine that could not be
 *  asked is left out of `listed`, so none of its terminals reads as
 *  gone. Never rejects. */
export async function observeMachineTerminals(
  machines: readonly string[]
): Promise<RemoteTerminalObservation> {
  const results = await Promise.allSettled(
    machines.map((machine) => observeRemoteTerminals(machine))
  );
  const observed: RemoteTerminalObservation = { terminals: [], listed: [] };
  results.forEach((result, i) => {
    const machine = machines[i]!;
    if (result.status === 'rejected') {
      log('warn', 'discovery', `could not list ${machine}'s sessions`, {
        error: String(result.reason),
      });
      return;
    }
    observed.listed.push(machine);
    observed.terminals.push(...result.value);
  });
  return observed;
}

/** The terminals this process held before a scan listed anything: one
 *  launched while a listing was out is not missing from it. */
export function heldTerminals(): string[] {
  return sessionNames().filter(
    (name) => sessionIdentity(name)?.kind === 'terminal'
  );
}

/** Terminals gone from the machines a scan listed, held ones included:
 *  terminal tabs are process-global, so one an earlier repository's
 *  scanner saw is reconciled too. A machine the scan could not list
 *  keeps its terminals: an unreachable machine never says one ended. */
export function endedTerminals(
  delta: DiscoveryDelta,
  next: DiscoveryScan,
  before: readonly string[],
  listed: ReadonlySet<string>
): string[] {
  const present = new Set(next.terminals.map((terminal) => terminal.name));
  return [
    ...new Set([
      ...delta.endedTerminals,
      ...before.filter((name) => !present.has(name)),
    ]),
  ].filter((name) => listed.has(sessionIdentity(name)?.machine ?? ''));
}
