import { homedir } from 'node:os';
import { isGitRepo, LOCAL_MACHINE, type DiscoveredTerminal } from '@n10/core';
import {
  createTerminalService,
  type TerminalFacts,
  type TerminalLaunch,
} from '@n10/engine';
import type {
  SessionBuffer,
  TerminalLaunchRequest,
  TerminalSummary,
} from '../contract.js';
import { affiliations } from './affiliations.js';
import { ensureRecent } from './recent-repos.js';
import {
  attachRelay,
  broadcastLaunchStep,
  newRelayEntry,
  relayBuffer,
  type RelayEntry,
} from './session-relay.js';
import { displayPath, terminalRepo } from './terminal-home.js';

/** Desktop owns output delivery and tab presentation; the engine owns lifecycle. */
const relays = new Map<string, RelayEntry>();
const terminals = createTerminalService({
  started(name, previousName) {
    const previous = previousName ? relays.get(previousName) : undefined;
    if (previousName && name !== previousName) relays.delete(previousName);
    const relay = newRelayEntry(previous?.seq ?? 0);
    relays.set(name, relay);
    attachRelay(name, relay);
  },
  ended: (name) => {
    relays.delete(name);
  },
  affiliations,
});

function summarize(facts: TerminalFacts, home: string): TerminalSummary {
  return {
    ...facts,
    displayPath: displayPath(facts.cwd, home),
    repo:
      facts.machine === LOCAL_MACHINE
        ? terminalRepo(facts.cwd, isGitRepo)
        : null,
  };
}
function noteRepository(summary: TerminalSummary): void {
  if (summary.repo) ensureRecent(summary.repo);
}

export async function launchTerminal(
  req: TerminalLaunchRequest & Pick<TerminalLaunch, 'machinePath'>,
  home: string = homedir()
): Promise<TerminalSummary> {
  const facts = await terminals.launch(req, () => {
    if (req.launchId)
      broadcastLaunchStep({ launchId: req.launchId, step: 'start' });
  });
  const summary = summarize(facts, home);
  noteRepository(summary);
  return summary;
}

export async function adoptTerminal(
  terminal: DiscoveredTerminal
): Promise<void> {
  noteRepository(summarize(await terminals.adopt(terminal), homedir()));
}
/** The machines whose discovery scan has finished, terminals adopted. */
const scanned = new Set<string>();

/** Discovery finished a scan of `machine`. */
export function noteTerminalsScanned(machine: string): void {
  scanned.add(machine);
}

export function scannedTerminalMachines(): string[] {
  return [...scanned];
}

export function listTerminals(home: string = homedir()): TerminalSummary[] {
  return terminals.list().map((facts) => summarize(facts, home));
}
export const killTerminal = terminals.stop;
export const forgetTerminal = terminals.forget;
export const isTerminal = terminals.has;
export const terminalNames = () => terminals.names();
export const agentTerminalNames = () => terminals.names('agent');
export function terminalBuffer(name: string): SessionBuffer | undefined {
  const relay = relays.get(name);
  return relay ? relayBuffer(relay) : undefined;
}
