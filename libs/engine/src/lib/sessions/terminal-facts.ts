import {
  getSession,
  getSpawnedAt,
  isSessionAlive,
  LOCAL_MACHINE,
  sessionIdentity,
  type Affiliation,
  type TerminalKind,
} from '@n10/core';

export interface TerminalRecord {
  kind: TerminalKind;
  cwd: string;
}

function taskFact(kind: TerminalKind, agent?: string, title?: string) {
  return kind === 'agent' && agent && title ? { taskTitle: title } : {};
}

function connectionFact(
  machine: string,
  session: ReturnType<typeof getSession>
) {
  return machine !== LOCAL_MACHINE && session?.pty.connectionState
    ? { connectionState: session.pty.connectionState }
    : {};
}

/** Transport facts are independent of which shell or repository observes them. */
export function terminalFacts(
  name: string,
  record: TerminalRecord,
  affiliationOf?: (machine: string) => Affiliation | undefined,
  /** When tmux created the session, once a listing has named it. */
  created?: number,
  taskTitle?: string
) {
  const session = getSession(name);
  const machine = sessionIdentity(name)?.machine ?? LOCAL_MACHINE;
  return {
    name,
    ...record,
    ...(session?.pty.name ? { tmuxName: session.pty.name } : {}),
    agent: session?.agent,
    running: isSessionAlive(name),
    spawnedAt: getSpawnedAt(name) ?? 0,
    machine,
    ...connectionFact(machine, session),
    ...listedFacts(affiliationOf?.(machine), created),
    ...taskFact(record.kind, session?.agent, taskTitle),
  };
}

/** What discovery's listing adds, once it has named the session. */
function listedFacts(
  affiliation: Affiliation | undefined,
  created: number | undefined
): { affiliation?: Affiliation; created?: number } {
  return {
    ...(affiliation ? { affiliation } : {}),
    ...(created !== undefined ? { created } : {}),
  };
}

export type TerminalFacts = ReturnType<typeof terminalFacts>;
