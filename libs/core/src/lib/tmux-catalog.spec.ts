import { beforeEach, expect, it, vi } from 'vitest';
import type { TmuxSessionSnapshot } from '@n10/terminal-tmux';

const state = vi.hoisted(() => ({
  snapshot: null as TmuxSessionSnapshot | null,
}));
vi.mock('@n10/terminal-tmux', () => ({
  tmuxSessionSnapshot: () => state.snapshot,
}));

const { tmuxCatalog, tmuxLaunchPlan } = await import('./tmux-catalog.js');

const target = { kind: 'tmux', name: 'old' } as const;
function observed(paneDead: boolean): TmuxSessionSnapshot {
  return {
    name: 'old',
    created: 1,
    paneDead,
    path: '/repo',
    options: { '@orchestra-spawner': 'n10' },
    incarnation: {
      name: 'old',
      sessionId: '$1',
      paneId: '%1',
      panePid: 100,
      serverPid: 9,
    },
  };
}

beforeEach(() => {
  state.snapshot = null;
});

it('reports no process for a retained exited pane, whose PID may have been reused', () => {
  state.snapshot = observed(true);
  expect(tmuxCatalog.snapshot(target)).toMatchObject({
    exited: true,
    incarnation: { kind: 'tmux', panePid: 100 },
  });
  expect(tmuxCatalog.snapshot(target)?.pid).toBeUndefined();
  state.snapshot = observed(false);
  expect(tmuxCatalog.snapshot(target)?.pid).toBe(100);
});

it('addresses tmux by the target name and keeps the incarnation it was given', () => {
  const expected = { kind: 'tmux', ...observed(false).incarnation } as const;
  expect(
    tmuxLaunchPlan({ mode: 'replace', target, expected, tags: {} })
  ).toEqual({ mode: 'replace', target: 'old', expected, tags: {} });
  expect(tmuxLaunchPlan({ mode: 'attach', target })).toEqual({
    mode: 'attach',
    target: 'old',
  });
});
