import { describe, expect, it } from 'vitest';
import type { TmuxSessionIncarnation } from '@n10/terminal-tmux';
import { taggedSession } from '../session-identity-read.js';
import { attachPlan, launchPlan } from './launch-plan.js';
import {
  listed,
  n10Terminal,
  n10Worktree,
  orchestraDir,
  REPO,
  WT,
} from '../../../tests/session-tags.js';

const worktree = {
  type: 'worktree',
  repo: REPO,
  path: WT,
  branch: 'feat/a',
} as const;
const expected: TmuxSessionIncarnation = {
  name: 'label',
  sessionId: '$1',
  paneId: '%2',
  panePid: 300,
  serverPid: 100,
};
const session = (tags: Record<string, string>, paneDead = true) =>
  taggedSession(listed('label', tags, { paneDead }))!;

describe('launchPlan', () => {
  it('creates a worktree session with its full record and pane', () => {
    const plan = launchPlan(worktree, null, 'claude', false, undefined, WT);
    expect(plan).toMatchObject({
      mode: 'create',
      paneOption: '@session-pane',
      tags: {
        '@session-worktree': WT,
        '@session-repo': REPO,
        '@session-agent': 'claude',
      },
    });
    expect(Object.keys(plan.mode === 'create' ? plan.tags : {}).at(-1)).toBe(
      '@session-version'
    );
  });

  it('creates a shell tab with no record and no pane', () => {
    const plan = launchPlan(
      { type: 'terminal', kind: 'shell', repo: REPO },
      null,
      undefined,
      false,
      undefined,
      REPO
    );
    expect(plan).toMatchObject({ mode: 'create', paneOption: undefined });
    expect(plan.mode === 'create' && plan.tags).not.toHaveProperty(
      '@session-version'
    );
  });

  // A session n10 could not read back would be lost on the next open,
  // and the open after it would start a second agent beside it.
  it.each([
    [
      'a checkout tags cannot hold',
      { ...worktree, path: `${WT}\nx` },
      'claude',
    ],
    ['an agent name tags cannot hold', worktree, 'My Agent'],
    ['no agent', worktree, undefined],
  ] as const)(
    'refuses to create a session with %s',
    (_label, request, agent) => {
      expect(() =>
        launchPlan(request, null, agent, false, undefined, request.path)
      ).toThrow("Couldn't start the session");
    }
  );

  it('refuses a shell tab whose directory tags cannot hold', () => {
    const dir = `${REPO}\nx`;
    expect(() =>
      launchPlan(
        { type: 'terminal', kind: 'shell', repo: dir },
        null,
        undefined,
        false,
        undefined,
        dir
      )
    ).toThrow("Couldn't start the session");
  });

  it('relaunches an existing session without rewriting its record', () => {
    const plan = launchPlan(
      worktree,
      session(n10Worktree()),
      'codex',
      false,
      undefined,
      WT
    );
    expect(plan).toEqual({
      mode: 'restart',
      target: 'label',
      retainOnExit: true,
      tags: {
        '@session-agent': 'codex',
        '@session-x-orchestra-agent-provisional': null,
        '@session-status': null,
        '@session-status-kind': null,
        '@session-status-at': null,
      },
    });
  });

  it.each([
    [
      'a record',
      orchestraDir(),
      {
        '@session-version': '1',
        '@session-cwd': '/home/h/notes',
        '@session-launcher': 'orchestra',
      },
    ],
    [
      'shell extensions',
      n10Terminal('shell'),
      { '@session-x-n10-session-type': 'shell', '@session-x-n10-dir': REPO },
    ],
  ])(
    'guards a replacement by the %s it was read from',
    (_label, tags, guard) => {
      const existing = session(tags, false);
      const request = {
        type: 'terminal',
        kind: 'agent',
        repo: existing.repo,
        target: 'label',
      } as const;
      const plan = launchPlan(
        request,
        existing,
        'claude',
        true,
        expected,
        '/tmp'
      );
      expect(plan).toMatchObject({ mode: 'replace', expectedTags: guard });
      expect(attachPlan(existing, expected)).toMatchObject({
        mode: 'attach',
        expectedTags: guard,
      });
    }
  );
});
