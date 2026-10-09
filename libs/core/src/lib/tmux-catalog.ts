import type { SessionTarget } from '@n10/terminal';
import {
  createTmuxBackend,
  tmuxKillSession,
  tmuxListSessionsRead,
  tmuxSessionSnapshot,
  type TmuxLaunchPlan,
  type TmuxSessionIncarnation,
  type TmuxSessionInfo,
} from '@n10/terminal-tmux';
import type {
  CatalogSession,
  SessionCatalog,
  SessionIncarnation,
  SessionLaunchPlan,
} from './session-catalog.js';

/** A listed tmux session in catalog terms. Remote listings use it too. */
export function tmuxCatalogSession(info: TmuxSessionInfo): CatalogSession {
  return {
    target: { kind: 'tmux', name: info.name },
    created: info.created,
    exited: info.paneDead,
    ...(info.exitCode == null ? {} : { exitCode: info.exitCode }),
    path: info.path,
    tags: { ...info.options },
  };
}

/** A session another backend holds is never reached through tmux. */
function tmuxName(target: SessionTarget): string {
  if (target.kind !== 'tmux')
    throw new Error(`${target.name} is not a tmux session`);
  return target.name;
}

function tmuxExpected(
  expected: SessionIncarnation | undefined
): TmuxSessionIncarnation | undefined {
  if (expected && expected.kind !== 'tmux')
    throw new Error(`${expected.name} is not a tmux session`);
  return expected;
}

/** A launch plan in tmux's terms, for a local or a remote server. */
export function tmuxLaunchPlan(plan: SessionLaunchPlan): TmuxLaunchPlan {
  if (plan.mode === 'create') return plan;
  const target = tmuxName(plan.target);
  if (plan.mode === 'replace')
    return { ...plan, target, expected: tmuxExpected(plan.expected)! };
  return { ...plan, target, expected: tmuxExpected(plan.expected) };
}

/** The local tmux server, through `@n10/terminal-tmux`. */
export const tmuxCatalog: SessionCatalog = {
  list(tags) {
    try {
      return tmuxListSessionsRead(tags)?.map(tmuxCatalogSession) ?? null;
    } catch {
      return null;
    }
  },
  snapshot(target, tags) {
    const observed = tmuxSessionSnapshot(tmuxName(target), tags);
    if (!observed) return null;
    return {
      ...tmuxCatalogSession(observed),
      incarnation: { kind: 'tmux', ...observed.incarnation },
      ...(observed.paneDead ? {} : { pid: observed.incarnation.panePid }),
    };
  },
  kill(target) {
    try {
      tmuxKillSession(tmuxName(target));
    } catch {
      // no server / no session — nothing to kill
    }
  },
  open(spec, plan) {
    return createTmuxBackend(spec, tmuxLaunchPlan(plan));
  },
};
