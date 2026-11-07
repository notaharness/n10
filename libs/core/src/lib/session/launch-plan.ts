import { realpathSync } from 'node:fs';
import type {
  TmuxLaunchPlan,
  TmuxSessionIncarnation,
} from '@n10/terminal-tmux';
import { sessionNames } from '../pty-registry.js';
import { LOCAL_MACHINE, sessionIdentity } from '../session-key.js';
import { SESSION_KEY, type TaggedSession } from '../session-identity.js';
import {
  identityGuard,
  isRecordable,
  recordsPane,
  relaunchTags,
  sessionTags,
} from '../session-identity-write.js';
import {
  terminalSessionLabel,
  worktreeSessionLabel,
} from '../session-label.js';
import type { SessionRequest } from './session-request.js';
import { worktreeIdentity } from './worktree-identity.js';

/**
 * The tmux plan for opening a session, once `open-session.ts` has
 * resolved what exists: attach to it, relaunch its process, or create
 * it. The tags come from `session-identity-write.ts`; a guarded plan
 * checks the identity tags the session was read from.
 */

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

/** A terminal agent's working directory as the convention records it:
 *  canonical, and only where this process can resolve it. */
function recordCwd(request: SessionRequest, cwd: string): string | undefined {
  if ((request.machine ?? LOCAL_MACHINE) !== LOCAL_MACHINE) return undefined;
  try {
    return realpathSync(cwd);
  } catch {
    return undefined;
  }
}

/** Restart or replace the process in a session that exists. */
function relaunchPlan(
  existing: TaggedSession,
  agent: string | undefined,
  fresh: boolean,
  expected: TmuxSessionIncarnation | undefined,
  retainOnExit: boolean
): TmuxLaunchPlan {
  const tags = relaunchTags(existing, agent, fresh);
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

export function launchPlan(
  request: SessionRequest,
  existing: TaggedSession | null,
  agent: string | undefined,
  fresh: boolean | undefined,
  expected: TmuxSessionIncarnation | undefined,
  cwd: string
): TmuxLaunchPlan {
  const worktree =
    request.type === 'worktree' ? worktreeIdentity(request, cwd) : null;
  const identity = worktree ?? {
    type: (request as Extract<SessionRequest, { type: 'terminal' }>).kind,
  };
  const retainOnExit = request.type === 'worktree' || request.kind === 'agent';
  if (existing)
    return relaunchPlan(existing, agent, !!fresh, expected, retainOnExit);
  const record = { agent, cwd: worktree ? undefined : recordCwd(request, cwd) };
  const tags = sessionTags(request.repo, identity, record);
  // A session without a record n10 can read back would be lost on the
  // next open, which would start a second agent beside it.
  if (!isRecordable(identity, tags))
    throw new Error(
      "Couldn't start the session: tmux session tags can't hold its directory or agent name."
    );
  return {
    mode: 'create',
    label:
      request.type === 'worktree'
        ? worktreeSessionLabel(request.repo, worktree!.branch)
        : terminalSessionLabel(request.repo, request.kind),
    tags,
    paneOption: recordsPane(identity) ? SESSION_KEY.pane : undefined,
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
