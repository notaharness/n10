import {
  getSession,
  getSpawnedAt,
  isSessionAlive,
  LOCAL_MACHINE,
  sessionIdentity,
  type SessionTarget,
  type TerminalKind,
} from '@n10/core';

export interface TerminalRecord {
  kind: TerminalKind;
  cwd: string;
  restore?: {
    target: SessionTarget;
    tags: Record<string, string>;
    agent?: string;
    env?: Record<string, string>;
    conversationId?: string;
  };
}

/** Transport facts are independent of which shell or repository observes them. */
export function terminalFacts(name: string, record: TerminalRecord) {
  const session = getSession(name);
  const machine = sessionIdentity(name)?.machine ?? LOCAL_MACHINE;
  return {
    name,
    ...record,
    ...(session?.pty.target ? { target: session.pty.target } : {}),
    agent: session?.agent,
    running: isSessionAlive(name),
    spawnedAt: getSpawnedAt(name) ?? 0,
    machine,
    restore: record.restore,
    ...(machine !== LOCAL_MACHINE && session?.pty.connectionState
      ? { connectionState: session.pty.connectionState }
      : {}),
  };
}
export type TerminalFacts = ReturnType<typeof terminalFacts>;
