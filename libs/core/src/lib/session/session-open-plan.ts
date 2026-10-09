import type {
  TmuxLaunchPlan,
  TmuxSessionIncarnation,
} from '@n10/terminal-tmux';
import { sessionNames } from '../pty-registry.js';
import { sessionIdentity } from '../session-key.js';
import {
  ORCHESTRA_TAG,
  sessionTags,
  terminalSessionLabel,
  worktreeSessionLabel,
  type TaggedSession,
} from '../session-identity.js';
import type { OpenSessionParams } from './open-session.js';
import type { SessionRequest } from './session-request.js';
import { worktreeIdentity } from './worktree-identity.js';

export function attachPlan(
  existing: TaggedSession,
  expected: TmuxSessionIncarnation | undefined
): TmuxLaunchPlan {
  return {
    mode: 'attach',
    target: existing.name,
    ...(expected ? { expected, expectedTags: identityGuard(existing) } : {}),
  };
}

export function launchPlan(
  request: SessionRequest,
  existing: TaggedSession | null,
  agent: string | undefined,
  fresh: boolean | undefined,
  expected: TmuxSessionIncarnation | undefined,
  cwd: string,
  restore?: OpenSessionParams['restore']
): TmuxLaunchPlan {
  const retainOnExit = request.type === 'worktree' || request.kind === 'agent';
  const agentTags: Record<string, string> = agent
    ? { [ORCHESTRA_TAG.agent]: agent }
    : {};
  if (existing) {
    const tags = {
      ...agentTags,
      ...(fresh
        ? {
            [ORCHESTRA_TAG.orchestrator]: null,
            [ORCHESTRA_TAG.orchestratorConfig]: null,
            [ORCHESTRA_TAG.lastReport]: null,
            [ORCHESTRA_TAG.target]: null,
          }
        : {}),
    };
    if (fresh && expected)
      return {
        mode: 'replace',
        target: existing.name,
        expected,
        retainOnExit,
        tags,
        expectedTags: identityGuard(existing),
      };
    // Unconfirmed restarts never use -k. An external live winner is left alone.
    return {
      mode: 'restart',
      target: existing.name,
      tags,
      retainOnExit,
      ...(expected ? { expected, expectedTags: identityGuard(existing) } : {}),
    };
  }
  return createPlan(request, cwd, restore, agentTags, retainOnExit);
}

function createPlan(
  request: SessionRequest,
  cwd: string,
  restore: OpenSessionParams['restore'],
  agentTags: Record<string, string>,
  retainOnExit: boolean
): TmuxLaunchPlan {
  const worktree =
    request.type === 'worktree' ? worktreeIdentity(request, cwd) : null;
  const identity = worktree ?? {
    type: (request as Extract<SessionRequest, { type: 'terminal' }>).kind,
  };
  return {
    mode: 'create',
    label:
      request.type === 'worktree'
        ? restore?.target.name ??
          worktreeSessionLabel(request.repo, worktree!.branch)
        : restore?.target.name ??
          terminalSessionLabel(request.repo, request.kind),
    tags: restore?.tags ?? {
      ...sessionTags(request.repo, identity),
      ...agentTags,
    },
    retainOnExit,
    excludedNames:
      request.type === 'terminal'
        ? sessionNames().flatMap((key) => {
            const identity = sessionIdentity(key);
            return identity?.kind === 'terminal' ? [identity.id] : [];
          })
        : undefined,
  };
}

function identityGuard(session: TaggedSession): Record<string, string> {
  return {
    [ORCHESTRA_TAG.repo]: session.repo,
    [ORCHESTRA_TAG.sessionType]: session.type,
    [ORCHESTRA_TAG.branch]: session.branch,
    [ORCHESTRA_TAG.spawner]: session.spawner,
  };
}
