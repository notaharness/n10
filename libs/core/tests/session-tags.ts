import {
  orchestraTags,
  terminalSessionTags,
  worktreeSessionTags,
} from '../src/testing/session-tags.js';
import type { TmuxSessionInfo } from '@n10/terminal-tmux';

/** Fixed tag sets for the core specs, one per kind of session. */

export const REPO = '/repos/alpha';
export const WT = '/repos/alpha/.worktrees/feat-a';

type Tags = Record<string, string>;

const ROUTING = orchestraTags({
  orchestrator: 'tmux:conductor',
  lastReport: 'DONE 2026-09-14T10:22:03Z inbox',
});

export function n10Worktree(agent = 'claude'): Tags {
  return worktreeSessionTags({
    launcher: 'n10',
    repo: REPO,
    worktreePath: WT,
    branch: 'feat/a',
    agent,
    pane: '%3',
  });
}

export function n10Terminal(kind: 'shell' | 'agent', dir = REPO): Tags {
  return terminalSessionTags({
    kind,
    dir,
    ...(kind === 'agent' ? { agent: 'codex', pane: '%4' } : {}),
  });
}

export function orchestraWorktree(): Tags {
  return {
    ...worktreeSessionTags({
      launcher: 'orchestra',
      repo: REPO,
      worktreePath: WT,
      branch: 'feat/a',
      agent: 'codex',
      pane: '%5',
    }),
    ...ROUTING,
  };
}

export function orchestraDir(dir = '/home/h/notes'): Tags {
  return {
    ...terminalSessionTags({ kind: 'dir', dir, agent: 'claude', pane: '%6' }),
    ...ROUTING,
  };
}

/** What n10 and Orchestra wrote on a worktree session before the
 *  shared convention: foreign now. */
export const LEGACY_WORKTREE: Tags = {
  '@orchestra-spawner': 'n10',
  '@orchestra-repo': REPO,
  '@orchestra-session-type': 'worktree',
  '@orchestra-branch': 'feat/a',
  '@orchestra-worktree-path': WT,
  '@orchestra-agent': 'claude',
};

/** `tags` without `keys`: what a writer that unset them leaves. */
export function without(tags: Tags, ...keys: string[]): Tags {
  return Object.fromEntries(
    Object.entries(tags).filter(([key]) => !keys.includes(key))
  );
}

export function listed(
  name: string,
  options: Tags | undefined,
  extra: Partial<TmuxSessionInfo> = {}
): TmuxSessionInfo {
  return { name, created: 10, path: '/p', paneDead: false, options, ...extra };
}
