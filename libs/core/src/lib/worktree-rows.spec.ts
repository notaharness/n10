import type * as Fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  names: [] as string[],
  createdFor: new Map<string, string>(),
  present: new Set<string>(),
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof Fs>()),
  existsSync: (path: string) => state.present.has(path),
}));
vi.mock('./pty-registry.js', () => ({
  sessionNames: () => state.names,
  getSession: (name: string) =>
    state.createdFor.has(name)
      ? { createdFor: state.createdFor.get(name) }
      : undefined,
}));
import { worktreeSessionKey, terminalSessionKey } from './session-key.js';
import { strandedSessionRows } from './worktree-rows.js';

const REPO = '/repo';
const checkout = (dir: string) => `/repo/.claude/worktrees/${dir}`;
const key = (dir: string, repo = REPO) =>
  worktreeSessionKey(`${repo}/.claude/worktrees/${dir}`, repo);

beforeEach(() => {
  state.names = [];
  state.createdFor.clear();
  state.present.clear();
});

describe('strandedSessionRows', () => {
  it('rows a running agent whose checkout is gone, labelled with its branch', () => {
    state.names = [key('feature-colour')];
    state.createdFor.set(key('feature-colour'), 'feature/colour');
    expect(strandedSessionRows(REPO, () => true)).toEqual([
      {
        name: key('feature-colour'),
        label: 'feature/colour',
        path: checkout('feature-colour'),
        running: true,
        worktreeRemoved: true,
      },
    ]);
  });

  // Its worktree row is the listing's; and a listing that failed or
  // has not been read must not strand an agent whose checkout is there.
  it('leaves out an agent whose checkout is still there', () => {
    state.names = [key('kept')];
    state.present.add(checkout('kept'));
    expect(strandedSessionRows(REPO, () => true)).toEqual([]);
  });

  // Already stranded, and something recreated the directory under it.
  it('keeps an agent it is told to keep whose checkout is back', () => {
    state.names = [key('back'), key('kept')];
    state.present.add(checkout('back'));
    state.present.add(checkout('kept'));
    expect(
      strandedSessionRows(
        REPO,
        () => true,
        (name) => name === key('back')
      )
    ).toEqual([expect.objectContaining({ name: key('back') })]);
  });

  it('leaves out an agent that has exited', () => {
    state.names = [key('done')];
    expect(strandedSessionRows(REPO, () => false)).toEqual([]);
  });

  it("leaves out other repositories' agents and terminals", () => {
    state.names = [key('other', '/elsewhere'), terminalSessionKey('shell-1')];
    expect(strandedSessionRows(REPO, () => true)).toEqual([]);
  });

  // A remote checkout cannot be looked for on this machine's disk.
  it("leaves out another machine's agent", () => {
    state.names = [
      worktreeSessionKey(
        checkout('remote'),
        REPO,
        'peer0123456789abcdef0123456789ab'
      ),
    ];
    expect(strandedSessionRows(REPO, () => true)).toEqual([]);
  });
});
