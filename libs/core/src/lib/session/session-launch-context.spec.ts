import { beforeEach, expect, it, vi } from 'vitest';
import { worktreeSessionKey } from '../session-key.js';
const state = vi.hoisted(() => ({
  agent: 'claude',
  dead: true,
  exists: true,
  report: 'PROGRESS 2026-01-01T00:00:00Z inbox',
  provisional: '',
}));
vi.mock('../session-resolver.js', () => ({
  resolveWorktreeSession: () => ({ name: 'player' }),
}));
vi.mock('@n10/terminal-tmux', () => ({
  tmuxSessionSnapshot: () =>
    state.exists
      ? {
          name: 'player',
          created: 1,
          paneDead: state.dead,
          path: '/repo/worktree',
          incarnation: {
            name: 'player',
            sessionId: '$0',
            paneId: '%0',
            panePid: 22,
            serverPid: 11,
          },
          options: {
            '@session-version': '1',
            '@session-launcher': 'orchestra',
            '@session-repo': '/repo',
            '@session-x-orchestra-branch': 'feature',
            '@session-worktree': '/repo/worktree',
            '@session-agent': state.agent,
            '@session-x-orchestra-agent-provisional': state.provisional,
            '@session-x-orchestra-orchestrator': 'tmux:boss',
            '@session-x-orchestra-last-report': state.report,
          },
        }
      : null,
}));
import { getSessionLaunchContext } from './session-launch-context.js';
const config = {
  agentId: 'claude' as const,
  aiCommand: 'custom',
  vendorAuth: {},
  vendorProject: {},
};
beforeEach(() => {
  state.agent = 'claude';
  state.dead = true;
  state.exists = true;
  state.report = 'PROGRESS 2026-01-01T00:00:00Z inbox';
  state.provisional = '';
});
it.each(['test', 'unknown', 'gemini'])(
  'does not promise continuation for a stopped %s agent',
  (agent) => {
    state.agent = agent;
    expect(
      getSessionLaunchContext(
        worktreeSessionKey('/repo/worktree', '/repo'),
        config
      )
    ).toMatchObject({ exists: true, running: false, canResume: false });
  }
);
// Orchestra's guess at the harness of a resume it has not started yet.
it('does not promise continuation for an agent Orchestra only guessed', () => {
  state.provisional = '1';
  const context = getSessionLaunchContext(
    worktreeSessionKey('/repo/worktree', '/repo'),
    config
  );
  expect(context).toMatchObject({ exists: true, canResume: false });
  expect(context.recordedAgent).toBeUndefined();
});
it('reads named resume capability and reporting details from the native snapshot', () => {
  expect(
    getSessionLaunchContext(
      worktreeSessionKey('/repo/worktree', '/repo'),
      config
    )
  ).toMatchObject({
    canResume: true,
    recordedAgent: 'claude',
    recordedAgentName: 'Claude',
    orchestrator: 'tmux:boss',
    lastReport: { kind: 'PROGRESS', timestamp: '2026-01-01T00:00:00Z' },
  });
});
it('treats a vanished native target as absent', () => {
  state.exists = false;
  expect(
    getSessionLaunchContext(
      worktreeSessionKey('/repo/worktree', '/repo'),
      config
    )
  ).toEqual({ exists: false, running: false, canResume: false });
});

it.each(['delivered', 'stored', 'inbox', 'queue', 'paste'])(
  'reads a Codex report delivered by %s',
  (outcome) => {
    state.agent = 'codex';
    state.report = `PROGRESS 2026-01-01T00:00:00Z ${outcome}`;
    expect(
      getSessionLaunchContext(
        worktreeSessionKey('/repo/worktree', '/repo'),
        config
      )
    ).toMatchObject({
      recordedAgent: 'codex',
      canResume: true,
      lastReport: { kind: 'PROGRESS', timestamp: '2026-01-01T00:00:00Z' },
    });
  }
);
it.each([
  'PROGRESS 2026-01-01T00:00:00Z',
  'PROGRESS invalid queue',
  'PROGRESS 2026-01-01T00:00:00Z queue extra',
])('ignores malformed report metadata %j', (report) => {
  state.report = report;
  expect(
    getSessionLaunchContext(
      worktreeSessionKey('/repo/worktree', '/repo'),
      config
    ).lastReport
  ).toBeUndefined();
});
