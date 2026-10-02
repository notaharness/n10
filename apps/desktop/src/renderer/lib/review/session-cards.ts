import type { BranchSession, MachineView } from '../../../host/contract.js';
import { resolveMachineLabel } from '../machines/machine-model.js';

/** One card in the review rail's session list. */
export interface SessionCard {
  name: string;
  kind: 'agent' | 'terminal';
  /** `Agent` for an agent, the checkout's or one in a terminal;
   *  `Terminal` for a shell. */
  title: 'Agent' | 'Terminal';
  running: boolean;
  /** The machine it runs on, for another machine's only. */
  machineLabel: string | null;
  connectionState?: BranchSession['connectionState'];
  machine: string;
  spawnedAt: number;
}

export function sessionCards(
  sessions: readonly BranchSession[],
  machines: readonly MachineView[] | undefined
): SessionCard[] {
  return sessions.map((s) => ({
    name: s.name,
    kind: s.kind,
    title:
      s.kind === 'terminal' && s.terminalKind === 'shell'
        ? 'Terminal'
        : 'Agent',
    running: s.running,
    machineLabel: resolveMachineLabel(s.machine, machines),
    machine: s.machine,
    spawnedAt: s.spawnedAt,
    ...(s.connectionState ? { connectionState: s.connectionState } : {}),
  }));
}

/** What a card says of its session, and in which tone: another
 *  machine's that cannot be reached is neither running here nor
 *  exited, and may well still be running there. */
export function cardStatus(card: SessionCard): {
  label: 'Running' | 'Waiting to reconnect' | 'Exited';
  tone: 'success' | 'warning' | 'muted';
} {
  if (!card.running) return { label: 'Exited', tone: 'muted' };
  if (card.connectionState && card.connectionState !== 'connected')
    return { label: 'Waiting to reconnect', tone: 'warning' };
  return { label: 'Running', tone: 'success' };
}

/**
 * The session whose terminal the pane shows: the one the reader picked
 * while it is still listed, else the tab's own agent, else the first.
 */
export function shownSession(
  cards: readonly SessionCard[],
  picked: string | null,
  own: string | undefined
): SessionCard | undefined {
  return (
    cards.find((c) => c.name === picked) ??
    cards.find((c) => c.name === own) ??
    cards[0]
  );
}

/** Names listed now that the previous listing did not have: a session
 *  just launched, which takes the pane. */
export function newSessionNames(
  previous: readonly SessionCard[] | null,
  next: readonly SessionCard[]
): string[] {
  if (!previous) return [];
  const known = new Set(previous.map((c) => c.name));
  return next.filter((c) => !known.has(c.name)).map((c) => c.name);
}
