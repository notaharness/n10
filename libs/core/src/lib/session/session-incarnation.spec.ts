import type * as Primitive from '@n10/terminal-tmux';
import { beforeEach, expect, it, vi } from 'vitest';
import { worktreeSessionKey } from '../session-key.js';
import { sessionIncarnationMatches } from './session-launch-context.js';
const state = vi.hoisted(() => ({
  snapshot: vi.fn(),
  native: 'player',
}));
vi.mock('../pty-registry.js', () => ({
  getSession: () => ({
    pty: { target: { kind: 'tmux', name: state.native } },
  }),
}));
vi.mock('@n10/terminal-tmux', async (original) => ({
  ...(await original<typeof Primitive>()),
  tmuxSessionSnapshot: state.snapshot,
}));
const expected = {
  kind: 'tmux',
  name: 'player',
  sessionId: '$1',
  paneId: '%2',
  panePid: 42,
  serverPid: 10,
} as const;
const local = worktreeSessionKey('/repo/wt', '/repo');
beforeEach(() => {
  state.native = 'player';
  state.snapshot.mockReset().mockReturnValue({ incarnation: expected });
});
it('compares the connected native target rather than the registry key', () => {
  expect(sessionIncarnationMatches(local, expected)).toBe(true);
  expect(state.snapshot).toHaveBeenCalledWith('player', undefined);
  state.snapshot.mockReturnValue({ incarnation: { ...expected, panePid: 99 } });
  expect(sessionIncarnationMatches(local, expected)).toBe(false);
});
it('refuses an unavailable native snapshot', () => {
  state.snapshot.mockReturnValue(null);
  expect(sessionIncarnationMatches(local, expected)).toBe(false);
});
it('never treats a same-named local session as a remote incarnation', () => {
  const remote = worktreeSessionKey('/repo/wt', '/repo', 'peer');
  expect(sessionIncarnationMatches(remote, expected)).toBe(false);
  expect(state.snapshot).not.toHaveBeenCalled();
});
