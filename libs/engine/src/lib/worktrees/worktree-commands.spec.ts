import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorktreeRemovalOutcome } from '@n10/core';
import { createWorktreeCommands } from './worktree-commands.js';

const state = vi.hoisted(() => ({
  outcome: 'removed' as WorktreeRemovalOutcome,
  calls: [] as unknown[][],
}));
vi.mock('@n10/core', () => ({
  removeWorktreeSession: async (...args: unknown[]) => {
    state.calls.push(args);
    return state.outcome;
  },
  checkWorktreeRemoval: vi.fn(),
}));
vi.mock('@n10/logger', () => ({ logError: vi.fn() }));
const approved = {
  verdict: 'clear',
  tip: 'abc',
  repo: '/repo/.git',
  checkout: '/repo/wt',
} as const;
beforeEach(() => {
  state.calls = [];
  state.outcome = 'removed';
});

function harness() {
  const watchers = {
    suspend: vi.fn(() => [42]),
    resume: vi.fn(async () => undefined),
    isCurrent: vi.fn(() => true),
  };
  const commands = createWorktreeCommands({ repo: '/captured', watchers });
  return { commands, watchers };
}
describe('worktree removal command', () => {
  it('suspends watchers and names the captured repo in the guarded operation', async () => {
    const { commands, watchers } = harness();
    await expect(commands.remove('topic', approved)).resolves.toBe('removed');
    expect(watchers.suspend).toHaveBeenCalledExactlyOnceWith(
      '/captured',
      'topic'
    );
    expect(state.calls).toEqual([['topic', approved, '/captured']]);
    expect(watchers.resume).not.toHaveBeenCalled();
  });
  it.each(['changed', 'git-refused', 'refused'] as const)(
    'restores watchers for a retained checkout: %s',
    async (outcome) => {
      state.outcome = outcome;
      const { commands, watchers } = harness();
      await expect(commands.remove('topic', approved)).resolves.toBe(outcome);
      expect(watchers.resume).toHaveBeenCalledExactlyOnceWith('/captured', 42);
    }
  );
  it('keeps watchers stopped when only the branch remains', async () => {
    state.outcome = 'kept-branch';
    const { commands, watchers } = harness();
    await commands.remove('topic', approved);
    expect(watchers.resume).not.toHaveBeenCalled();
  });
  it('does not restart a watcher after switching repository', async () => {
    state.outcome = 'changed';
    const { commands, watchers } = harness();
    watchers.isCurrent.mockReturnValue(false);
    await commands.remove('topic', approved);
    expect(watchers.resume).not.toHaveBeenCalled();
  });
  it('returns the removal outcome if restoring a watcher fails', async () => {
    state.outcome = 'changed';
    const { commands, watchers } = harness();
    watchers.resume.mockRejectedValue(new Error('Unavailable'));
    await expect(commands.remove('topic', approved)).resolves.toBe('changed');
  });
});
