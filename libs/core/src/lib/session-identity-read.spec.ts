import { describe, expect, it } from 'vitest';
import { isTerminalSession } from './session-identity.js';
import { taggedSession } from './session-identity-read.js';
import {
  LEGACY_WORKTREE,
  listed,
  n10Terminal,
  n10Worktree,
  orchestraDir,
  orchestraWorktree,
  REPO,
  WT,
  without,
} from '../../tests/session-tags.js';

const read = (tags: Record<string, string> | undefined) =>
  taggedSession(listed('label', tags));

describe('taggedSession', () => {
  it('carries the dedicated primary-pane title column', () => {
    const info = {
      ...listed('agent', n10Terminal('agent')),
      paneTitle: 'Fix auth',
    };
    expect(taggedSession(info)?.paneTitle).toBe('Fix auth');
  });
  it('reads one of ours from its tags, never from its name', () => {
    expect(taggedSession(listed('anything-at-all', n10Worktree()))).toEqual({
      name: 'anything-at-all',
      created: 10,
      paneDead: false,
      path: '/p',
      spawner: 'n10',
      repo: REPO,
      type: 'worktree',
      branch: 'feat/a',
      worktreePath: WT,
      agent: 'claude',
      machine: 'local',
      identityTags: {
        '@session-version': '1',
        '@session-launcher': 'n10',
        '@session-worktree': WT,
        '@session-repo': REPO,
        '@session-cwd': WT,
        '@session-x-n10-branch': 'feat/a',
        '@session-x-n10-dir': '',
      },
    });
  });

  it.each([
    [
      'an n10 agent tab',
      n10Terminal('agent'),
      {
        spawner: 'n10',
        repo: REPO,
        type: 'agent',
        worktreePath: '',
        agent: 'codex',
      },
    ],
    [
      'an n10 shell tab',
      n10Terminal('shell'),
      {
        spawner: 'n10',
        repo: REPO,
        type: 'shell',
        branch: '',
        worktreePath: '',
      },
    ],
    [
      'an Orchestra worktree player',
      orchestraWorktree(),
      {
        spawner: 'orchestra',
        repo: REPO,
        type: 'worktree',
        branch: 'feat/a',
        worktreePath: WT,
        agent: 'codex',
        orchestrator: 'tmux:conductor',
        lastReport: 'DONE 2026-09-14T10:22:03Z inbox',
      },
    ],
    [
      'an Orchestra dir player',
      orchestraDir(),
      {
        spawner: 'orchestra',
        repo: '/home/h/notes',
        type: 'agent',
        branch: '',
        worktreePath: '',
        agent: 'claude',
        orchestrator: 'tmux:conductor',
      },
    ],
  ])('reads %s', (_kind, tags, fields) => {
    expect(read(tags)).toMatchObject(fields);
  });

  it("reads Orchestra's dir player as an agent terminal", () => {
    expect(isTerminalSession(read(orchestraDir())!)).toBe(true);
  });

  it("scopes n10's agent tab by the tab's directory, another launcher's by its cwd", () => {
    expect(
      read({
        ...n10Terminal('agent', '/home/h/link'),
        '@session-cwd': '/home/h/real',
      })
    ).toMatchObject({ repo: '/home/h/link' });
    expect(read(orchestraDir('/home/h/real'))).toMatchObject({
      repo: '/home/h/real',
    });
  });

  // An agent tab or dir player sitting inside a checkout is still not
  // a worktree session: only a record naming both checkouts is.
  it('reads a record naming only one checkout as an agent in a directory', () => {
    expect(read(without(n10Worktree(), '@session-repo'))).toMatchObject({
      type: 'agent',
      worktreePath: '',
    });
  });

  // Orchestra records `claude` for a resume before it knows the harness.
  it('reads an agent Orchestra has only guessed as unknown, and the session as ours', () => {
    const session = read({
      ...orchestraWorktree(),
      '@session-x-orchestra-agent-provisional': '1',
    });
    expect(session).toMatchObject({ spawner: 'orchestra', type: 'worktree' });
    expect(session).not.toHaveProperty('agent');
  });

  it('leaves out the Orchestra routing a session does not carry', () => {
    const session = read(n10Worktree())!;
    expect(session).not.toHaveProperty('orchestrator');
    expect(session).not.toHaveProperty('lastReport');
    expect(session).not.toHaveProperty('target');
    expect(
      read({
        ...n10Terminal('shell'),
        '@session-x-orchestra-target': 'codex:x',
      })
    ).toMatchObject({ type: 'shell', target: 'codex:x' });
  });

  // A session whose name is exactly what n10 would have chosen, but
  // that carries no valid record, is foreign. Half a record is not
  // enough, and neither are the tags releases before the convention
  // wrote.
  it.each([
    ['no tags', undefined],
    ['empty tags', {}],
    ['only the @orchestra-* tags of an older release', LEGACY_WORKTREE],
    ['no version', without(n10Worktree(), '@session-version')],
    ['an unsupported major', { ...n10Worktree(), '@session-version': '2' }],
    ['no agent', without(n10Worktree(), '@session-agent')],
    [
      'an agent that is not a token',
      { ...n10Worktree(), '@session-agent': 'Claude Code' },
    ],
    ['no launcher', without(n10Worktree(), '@session-launcher')],
    [
      'a launcher n10 does not accept',
      { ...n10Worktree(), '@session-launcher': 'tmuxinator' },
    ],
    [
      'a relative checkout',
      { ...n10Worktree(), '@session-worktree': 'repos/alpha' },
    ],
    [
      'a shell tab with a version',
      { ...n10Terminal('shell'), '@session-version': '1' },
    ],
    [
      'a shell tab without its directory',
      without(n10Terminal('shell'), '@session-x-n10-dir'),
    ],
    [
      'an unknown n10 session type alone',
      { '@session-x-n10-session-type': 'player', '@session-x-n10-dir': REPO },
    ],
  ])('treats a session with %s as foreign', (_label, tags) => {
    expect(read(tags)).toBeNull();
  });

  it('guards a shell tab by its extensions, and a dir player by its cwd', () => {
    expect(read(n10Terminal('shell'))!.identityTags).toEqual({
      '@session-x-n10-session-type': 'shell',
      '@session-x-n10-dir': REPO,
    });
    expect(read(orchestraDir())!.identityTags).toMatchObject({
      '@session-x-orchestra-branch': '',
      '@session-cwd': '/home/h/notes',
      '@session-launcher': 'orchestra',
    });
  });
});
