import { describe, expect, it } from 'vitest';
import { taggedSession } from './session-identity-read.js';
import {
  identityGuard,
  relaunchTags,
  sessionTags,
} from './session-identity-write.js';
import {
  listed,
  n10Terminal,
  n10Worktree,
  orchestraWorktree,
  REPO,
  WT,
} from '../../tests/session-tags.js';

const worktree = {
  type: 'worktree',
  branch: 'feat/a',
  worktreePath: WT,
} as const;

const read = (tags: Record<string, string>) =>
  taggedSession(listed('label', tags))!;

describe('sessionTags', () => {
  it('writes the core record, the extensions, then the version', () => {
    expect(
      Object.entries(sessionTags(REPO, worktree, { agent: 'claude' }))
    ).toEqual([
      ['@session-launcher', 'n10'],
      ['@session-agent', 'claude'],
      ['@session-cwd', WT],
      ['@session-worktree', WT],
      ['@session-repo', REPO],
      ['@session-x-n10-session-type', 'worktree'],
      ['@session-x-n10-branch', 'feat/a'],
      ['@session-version', '1'],
    ]);
  });

  it("records an agent tab's directory, and its cwd only where it resolved", () => {
    expect(
      sessionTags(
        '/home/h/link',
        { type: 'agent' },
        { agent: 'codex', cwd: '/home/h/real' }
      )
    ).toEqual({
      '@session-launcher': 'n10',
      '@session-agent': 'codex',
      '@session-cwd': '/home/h/real',
      '@session-x-n10-session-type': 'agent',
      '@session-x-n10-dir': '/home/h/link',
      '@session-version': '1',
    });
    expect(
      sessionTags('/home/h/link', { type: 'agent' }, { agent: 'codex' })
    ).not.toHaveProperty('@session-cwd');
  });

  // A shell has no agent, so it does not participate in the convention.
  it("gives a shell tab n10's extensions and no record", () => {
    expect(sessionTags(REPO, { type: 'shell' }, { agent: 'claude' })).toEqual({
      '@session-x-n10-session-type': 'shell',
      '@session-x-n10-dir': REPO,
    });
  });

  it.each([
    ['no agent', REPO, worktree, {}],
    [
      'an agent the convention cannot name',
      REPO,
      worktree,
      { agent: 'Claude Code' },
    ],
    [
      'a checkout it cannot encode',
      REPO,
      { ...worktree, worktreePath: `${WT}\nx` },
      { agent: 'claude' },
    ],
    ['a relative main checkout', 'repos/alpha', worktree, { agent: 'claude' }],
  ] as const)(
    'publishes no version for a record with %s, and no empty value',
    (_label, repo, identity, context) => {
      const tags = sessionTags(repo, identity, context);
      expect(tags).not.toHaveProperty('@session-version');
      expect(Object.values(tags)).not.toContain('');
    }
  );

  it.each([
    [
      'a worktree session',
      worktree,
      { type: 'worktree', worktreePath: WT, branch: 'feat/a' },
    ],
    ['an agent tab', { type: 'agent' }, { type: 'agent', repo: REPO }],
    ['a shell tab', { type: 'shell' }, { type: 'shell', repo: REPO }],
  ] as const)(
    'writes %s so it reads back as one of ours',
    (_label, identity, fields) => {
      const context =
        identity.type === 'shell' ? {} : { agent: 'claude', cwd: REPO };
      expect(read(sessionTags(REPO, identity, context))).toMatchObject({
        spawner: 'n10',
        ...fields,
      });
    }
  );
});

describe('relaunchTags', () => {
  it('records the launched agent and clears status', () => {
    expect(relaunchTags(read(orchestraWorktree()), 'claude', false)).toEqual({
      '@session-agent': 'claude',
      '@session-x-orchestra-agent-provisional': null,
      '@session-status': null,
      '@session-status-kind': null,
      '@session-status-at': null,
    });
  });

  it("clears Orchestra's routing for a fresh conversation", () => {
    expect(
      relaunchTags(read(orchestraWorktree()), 'claude', true)
    ).toMatchObject({
      '@session-x-orchestra-orchestrator': null,
      '@session-x-orchestra-orchestrator-config': null,
      '@session-x-orchestra-last-report': null,
      '@session-x-orchestra-target': null,
    });
  });

  // The agent n10 launched is the one that ran: Orchestra's guess is
  // gone, in the same queue.
  it("clears Orchestra's provisional mark with the agent it records", () => {
    const writes = relaunchTags(
      read({
        ...orchestraWorktree(),
        '@session-x-orchestra-agent-provisional': '1',
      }),
      'codex',
      false
    );
    expect(writes).toMatchObject({
      '@session-agent': 'codex',
      '@session-x-orchestra-agent-provisional': null,
    });
  });

  // Unsetting the agent would make the session foreign.
  it('leaves the agent as it was for one the convention cannot name, and on a shell', () => {
    expect(
      relaunchTags(read(n10Worktree()), 'My Agent', false)
    ).not.toHaveProperty('@session-agent');
    expect(
      relaunchTags(read(n10Terminal('shell')), 'claude', false)
    ).not.toHaveProperty('@session-agent');
  });

  it('never rewrites the record or its version', () => {
    const writes = relaunchTags(read(n10Worktree()), 'codex', true);
    for (const key of [
      '@session-version',
      '@session-launcher',
      '@session-worktree',
      '@session-repo',
      '@session-cwd',
    ])
      expect(writes).not.toHaveProperty(key);
  });
});

describe('identityGuard', () => {
  it('guards the tags the session was read from', () => {
    const session = read(n10Worktree());
    expect(identityGuard(session)).toEqual(session.identityTags);
    expect(identityGuard(session)).toHaveProperty('@session-version', '1');
  });
});
