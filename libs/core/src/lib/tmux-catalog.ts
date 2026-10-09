import type { SessionTarget } from '@n10/terminal';
import {
  createTmuxBackend,
  tmuxKillSession,
  tmuxListSessionsRead,
  tmuxSessionSnapshot,
  type TmuxLaunchPlan,
  type TmuxSessionInfo,
} from '@n10/terminal-tmux';
import type {
  CatalogSession,
  SessionCatalog,
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

function tmuxName(target: SessionTarget): string {
  return target.name;
}

/** A launch plan in tmux's terms, for a local or a remote server. An
 *  incarnation already carries tmux's fields. */
export function tmuxLaunchPlan(plan: SessionLaunchPlan): TmuxLaunchPlan {
  return plan.mode === 'create'
    ? plan
    : { ...plan, target: tmuxName(plan.target) };
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
