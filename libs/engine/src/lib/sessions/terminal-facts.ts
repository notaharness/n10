import {
  getSession,
  getSpawnedAt,
  isSessionAlive,
  LOCAL_MACHINE,
  sessionIdentity,
  type TerminalKind,
} from '@n10/core';

export interface TerminalRecord {
  kind: TerminalKind;
  cwd: string;
}

/** Transport facts are independent of which shell or repository observes them. */
export function terminalFacts(name: string, record: TerminalRecord) {
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
    ...(machine !== LOCAL_MACHINE && session?.pty.connectionState
      ? { connectionState: session.pty.connectionState }
      : {}),
  };
}
export type TerminalFacts = ReturnType<typeof terminalFacts>;
