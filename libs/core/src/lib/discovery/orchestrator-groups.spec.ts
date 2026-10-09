import { describe, expect, it } from 'vitest';
import type { TaggedSession } from '../session-identity.js';
import { terminalSessionKey, worktreeSessionKey } from '../session-key.js';
import { orchestratorGroups } from './orchestrator-groups.js';

/**
 * An orchestrator is the session its players' `@orchestra-orchestrator`
 * names: by name for `tmux:`, by its `@orchestra-target` for a
 * conversation. Nothing else makes a session one.
 */

const CLAUDE = 'claude:7c0ffee0-1234-4abc-8def-0123456789ab';
const CODEX = 'codex:11111111-2222-3333-4444-555555555555';
const PEER = '1234567890abcdef1234567890abcdef';
const TRANSLOCO = '/home/u/transloco';

let created = 0;
function terminal(
  name: string,
  tags: Partial<TaggedSession> = {}
): TaggedSession {
  return {
    target: { kind: 'tmux', name },
    created: ++created,
    exited: false,
    path: `/home/u/${name}`,
    spawner: 'n10',
    repo: '/home/u/repo',
    type: 'shell',
    branch: '',
    worktreePath: '',
    machine: 'local',
    ...tags,
  };
}
function player(
  branch: string,
  orchestrator: string,
  tags: Partial<TaggedSession> = {}
): TaggedSession {
  return terminal(`repo-${branch}`, {
    spawner: 'orchestra',
    type: 'worktree',
    branch,
    worktreePath: `/home/u/repo/.claude/worktrees/${branch}`,
    orchestrator,
    ...tags,
  });
}
const tab = (name: string, machine = 'local') => ({
  key: terminalSessionKey(name, machine),
  repo: '/home/u/repo',
  worktree: '',
});
const wt = (branch: string) => {
  const worktree = `/home/u/repo/.claude/worktrees/${branch}`;
  return {
    key: worktreeSessionKey(worktree, '/home/u/repo', 'local'),
    repo: '/home/u/repo',
    worktree,
  };
};

describe('orchestratorGroups', () => {
  it('finds a conversation by the target its session was marked with', () => {
    const sessions = [
      terminal('repo-shell', { orchestraTarget: CLAUDE }),
      player('a', CLAUDE),
      player('b', CLAUDE),
      terminal('other-shell'),
    ];
    expect(orchestratorGroups(sessions)).toEqual([
      { orchestrator: tab('repo-shell'), players: [wt('a'), wt('b')] },
    ]);
  });

  it('finds a tmux target by the session name, unmarked', () => {
    const sessions = [terminal('gemini-tab'), player('a', 'tmux:gemini-tab')];
    expect(orchestratorGroups(sessions)).toEqual([
      { orchestrator: tab('gemini-tab'), players: [wt('a')] },
    ]);
  });

  it('groups a dir player, which is a terminal tab, like a worktree one', () => {
    const sessions = [
      terminal('repo-agent', { type: 'agent', orchestraTarget: CODEX }),
      terminal('notes-dir', {
        spawner: 'orchestra',
        type: 'agent',
        orchestrator: CODEX,
      }),
    ];
    expect(orchestratorGroups(sessions)).toEqual([
      { orchestrator: tab('repo-agent'), players: [tab('notes-dir')] },
    ]);
  });

  it('keeps a marked orchestrator whose players are all gone', () => {
    expect(
      orchestratorGroups([terminal('t', { orchestraTarget: CLAUDE })])
    ).toEqual([{ orchestrator: tab('t'), players: [] }]);
    // A tmux target is no mark: unnamed by any player, it is no one.
    expect(orchestratorGroups([terminal('gemini-tab')])).toEqual([]);
  });

  it('leaves a player whose target no listed session answers to alone', () => {
    // A Claude Desktop orchestrator, one outside tmux, or a session since
    // closed: no session carries the target, so nothing groups.
    expect(orchestratorGroups([terminal('t'), player('a', CLAUDE)])).toEqual(
      []
    );
    expect(orchestratorGroups([player('a', 'tmux:gone')])).toEqual([]);
  });

  it('groups players whatever repository they work in', () => {
    // A worktree of another repository, and a dir player (Orchestra's
    // `dir`, read as an agent terminal) in a directory of its own.
    const other = player('x', CLAUDE, {
      repo: TRANSLOCO,
      worktreePath: `${TRANSLOCO}/.claude/worktrees/x`,
    });
    const dir = terminal('transloco-dir', {
      spawner: 'orchestra',
      type: 'agent',
      repo: TRANSLOCO,
      path: TRANSLOCO,
      orchestrator: CLAUDE,
    });
    expect(
      orchestratorGroups([
        terminal('mc-shell', { orchestraTarget: CLAUDE }),
        other,
        dir,
      ])
    ).toEqual([
      {
        orchestrator: tab('mc-shell'),
        players: [
          {
            key: worktreeSessionKey(
              `${TRANSLOCO}/.claude/worktrees/x`,
              TRANSLOCO,
              'local'
            ),
            repo: TRANSLOCO,
            worktree: `${TRANSLOCO}/.claude/worktrees/x`,
          },
          { ...tab('transloco-dir'), repo: TRANSLOCO },
        ],
      },
    ]);
  });

  it('leaves a beam target, an orchestrator on another machine, alone', () => {
    const sessions = [
      terminal('near-shell', { orchestraTarget: CLAUDE }),
      player('a', `beam:${PEER}/${CLAUDE}`),
    ];
    expect(orchestratorGroups(sessions)).toEqual([
      { orchestrator: tab('near-shell'), players: [] },
    ]);
  });

  it('never makes a session its own player', () => {
    const self = terminal('loop', {
      orchestraTarget: CLAUDE,
      orchestrator: CLAUDE,
    });
    expect(orchestratorGroups([self])).toEqual([
      { orchestrator: tab('loop'), players: [] },
    ]);
  });

  it('keeps several orchestrators apart', () => {
    const sessions = [
      terminal('one', { orchestraTarget: CLAUDE }),
      terminal('two', { orchestraTarget: CODEX }),
      player('a', CODEX),
      player('b', CLAUDE),
    ];
    expect(orchestratorGroups(sessions)).toEqual([
      { orchestrator: tab('one'), players: [wt('b')] },
      { orchestrator: tab('two'), players: [wt('a')] },
    ]);
  });
});
