import {
  tmuxSessionSnapshot,
  sameTmuxIncarnation,
  type TmuxSessionIncarnation,
} from '@n10/terminal-tmux';
import type { AppConfig } from '@n10/vcs-core';
import {
  LISTED_TAGS,
  taggedSession,
  isWorktreeSessionFor,
} from '../session-identity.js';
import { resolveWorktreeSession } from '../session-resolver.js';
import { getSession } from '../pty-registry.js';
import { LOCAL_MACHINE, sessionIdentity } from '../session-key.js';
import { isKnownAgentId, resolveAgent } from '../agents/registry.js';

export type SessionIncarnation = TmuxSessionIncarnation;
export interface SessionLaunchContext {
  exists: boolean;
  running: boolean;
  canResume: boolean;
  recordedAgent?: string;
  recordedAgentName?: string;
  orchestrator?: string;
  lastReport?: { kind: string; timestamp: string };
  incarnation?: SessionIncarnation;
}

/** Use native state, never a retained rendering entry, to describe a launch target. */
export function getSessionLaunchContext(
  name: string,
  config: AppConfig
): SessionLaunchContext {
  const empty = { exists: false, running: false, canResume: false };
  const identity = sessionIdentity(name);
  if (identity?.kind !== 'worktree') return empty;
  const candidate = resolveWorktreeSession(identity.repo, identity.path);
  if (!candidate) return empty;
  const snapshot = tmuxSessionSnapshot(candidate.name, LISTED_TAGS);
  const session = snapshot && taggedSession(snapshot);
  if (!session || !isWorktreeSessionFor(session, identity.repo, identity.path))
    return empty;
  const known = session.agent && isKnownAgentId(session.agent);
  const agent = known
    ? resolveAgent({
        ...config,
        agentId: session.agent as AppConfig['agentId'],
      })
    : undefined;
  const lastReport = parseReport(session.lastReport);
  return {
    exists: true,
    running: !session.paneDead,
    canResume: !!agent?.resume,
    recordedAgent: session.agent,
    recordedAgentName: displayName(session.agent, agent?.name),
    orchestrator: session.orchestrator,
    incarnation: snapshot!.incarnation,
    ...(lastReport ? { lastReport } : {}),
  };
}

function parseReport(value?: string): SessionLaunchContext['lastReport'] {
  // Orchestra records `KIND TIMESTAMP OUTCOME` (delivered/stored/inbox/queue/paste).
  const report = value?.match(/^(\S+)\s+(\S+)\s+\S+$/);
  return report && !Number.isNaN(Date.parse(report[2]))
    ? { kind: report[1], timestamp: report[2] }
    : undefined;
}

function displayName(
  recorded?: string,
  knownName?: string
): string | undefined {
  return knownName ?? (recorded === 'test' ? 'Custom' : recorded);
}

/** Compare a held local connection with native state before reusing an approval. */
export function sessionIncarnationMatches(
  name: string,
  expected: SessionIncarnation
): boolean {
  const machine = sessionIdentity(name)?.machine ?? LOCAL_MACHINE;
  if (machine !== LOCAL_MACHINE) return false;
  const nativeName = getSession(name)?.pty.name;
  const live = nativeName && tmuxSessionSnapshot(nativeName)?.incarnation;
  return !!live && sameTmuxIncarnation(live, expected);
}
