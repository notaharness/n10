import { describe, expect, it, vi } from 'vitest';
import type { TaggedSession } from '../session-identity.js';
import { worktreeSessionKey } from '../session-key.js';
import {
  rebindMovedSessions,
  type MovedSessionDeps,
} from './moved-sessions.js';

vi.mock('@n10/logger', () => ({ log: () => undefined }));

const ROOT = '/new/repo';
const checkout = (dir: string) => `${ROOT}/.claude/worktrees/${dir}`;
const oldCheckout = (dir: string) => `/old/repo/.claude/worktrees/${dir}`;

function session(
  name: string,
  worktreePath: string,
  extra: Partial<TaggedSession> = {}
): TaggedSession {
  return {
    name,
    created: 1,
    paneDead: false,
    path: worktreePath,
    spawner: 'n10',
    repo: '/old/repo',
    type: 'worktree',
    branch: name,
    worktreePath,
    machine: 'local',
    ...extra,
  };
}

/** A world where only `existing` paths exist and each pane runs in
 *  `cwd[name]`. Records every rewrite. */
function world(
  cwd: Record<string, string>,
  existing: string[] = [],
  extra: MovedSessionDeps = {}
) {
  const retagged: [string, Record<string, string>][] = [];
  const asked: string[] = [];
  const deps: MovedSessionDeps = {
    exists: (path) => existing.includes(path),
    paneCwd: (name) => {
      asked.push(name);
      return cwd[name] ?? '';
    },
    retag: (name, tags) => {
      retagged.push([name, tags]);
      return true;
    },
    held: () => [],
    ...extra,
  };
  return { deps, retagged, asked };
}

const listed = [{ path: checkout('a') }, { path: checkout('b') }];

describe('rebindMovedSessions', () => {
  it('rebinds a session whose checkout is gone to the listed checkout its agent is in', () => {
    const { deps, retagged } = world({ a: checkout('a') });
    const result = rebindMovedSessions(
      [session('a', oldCheckout('a'))],
      ROOT,
      listed,
      deps
    );
    expect(retagged).toEqual([
      [
        'a',
        {
          '@orchestra-worktree-path': checkout('a'),
          '@orchestra-repo': ROOT,
        },
      ],
    ]);
    expect(result[0]).toMatchObject({
      repo: ROOT,
      worktreePath: checkout('a'),
    });
  });

  it('leaves a session whose checkout still exists without asking tmux', () => {
    const { deps, retagged, asked } = world({ a: checkout('b') }, [
      checkout('a'),
    ]);
    const sessions = [session('a', checkout('a'), { repo: ROOT })];
    expect(rebindMovedSessions(sessions, ROOT, listed, deps)).toEqual(sessions);
    expect(asked).toEqual([]);
    expect(retagged).toEqual([]);
  });

  // The branch is never evidence: checkout `a` has the session's
  // branch, but the agent is not in it.
  it('never rebinds by branch, only by where the agent runs', () => {
    const { deps, retagged } = world({ a: '/somewhere/else' });
    rebindMovedSessions(
      [session('a', oldCheckout('a'), { branch: 'a' })],
      ROOT,
      listed,
      deps
    );
    expect(retagged).toEqual([]);
  });

  it('requires the agent to run in the checkout root, not below it', () => {
    const { deps, retagged } = world({ a: `${checkout('a')}/src` });
    rebindMovedSessions([session('a', oldCheckout('a'))], ROOT, listed, deps);
    expect(retagged).toEqual([]);
  });

  // tmux reports a deleted working directory with this suffix.
  it('ignores an agent whose directory was deleted', () => {
    const { deps, retagged } = world({ a: `${oldCheckout('a')} (deleted)` });
    rebindMovedSessions([session('a', oldCheckout('a'))], ROOT, listed, deps);
    expect(retagged).toEqual([]);
  });

  it('refuses a checkout another session claims', () => {
    const { deps, retagged } = world({ stale: checkout('a') }, [checkout('a')]);
    rebindMovedSessions(
      [
        session('owner', checkout('a'), { repo: ROOT }),
        session('stale', oldCheckout('x')),
      ],
      ROOT,
      listed,
      deps
    );
    expect(retagged).toEqual([]);
  });

  it('binds only the first of two stale sessions in one checkout', () => {
    const { deps, retagged } = world({
      first: checkout('a'),
      second: checkout('a'),
    });
    rebindMovedSessions(
      [
        session('first', oldCheckout('a')),
        session('second', oldCheckout('a2')),
      ],
      ROOT,
      listed,
      deps
    );
    expect(retagged.map(([name]) => name)).toEqual(['first']);
  });

  it('skips a dead pane, a remote session and one this process holds', () => {
    const held = session('held', oldCheckout('b'));
    const { deps, retagged, asked } = world(
      { dead: checkout('a'), remote: checkout('a'), held: checkout('b') },
      [],
      { held: () => [worktreeSessionKey(held.worktreePath, held.repo)] }
    );
    rebindMovedSessions(
      [
        session('dead', oldCheckout('a'), { paneDead: true }),
        session('remote', oldCheckout('a'), { machine: 'peer' }),
        held,
      ],
      ROOT,
      listed,
      deps
    );
    expect(asked).toEqual([]);
    expect(retagged).toEqual([]);
  });

  it('keeps the old tags when tmux refuses the rewrite', () => {
    const { deps } = world({ a: checkout('a') }, [], { retag: () => false });
    const sessions = [session('a', oldCheckout('a'))];
    expect(rebindMovedSessions(sessions, ROOT, listed, deps)).toEqual(sessions);
  });

  it('ignores terminal sessions', () => {
    const { deps, asked } = world({ t: checkout('a') });
    rebindMovedSessions(
      [session('t', '', { type: 'shell' })],
      ROOT,
      listed,
      deps
    );
    expect(asked).toEqual([]);
  });
});
