import { describe, expect, it, vi } from 'vitest';
import type { TaggedSession } from '../session-identity.js';
import { worktreeSessionKey } from '../session-key.js';
import {
  rebindMovedSessions,
  type MovedSessionDeps,
} from './moved-sessions.js';

vi.mock('@n10/logger', () => ({ log: () => undefined }));

const OLD = '/old/repo';
const ROOT = '/new/repo';
const checkout = (dir: string) => `${ROOT}/.claude/worktrees/${dir}`;
const oldCheckout = (dir: string) => `${OLD}/.claude/worktrees/${dir}`;

function session(
  name: string,
  worktreePath = oldCheckout(name),
  extra: Partial<TaggedSession> = {}
): TaggedSession {
  return {
    name,
    created: 1,
    paneDead: false,
    path: worktreePath,
    spawner: 'n10',
    repo: OLD,
    type: 'worktree',
    branch: name,
    worktreePath,
    machine: 'local',
    ...extra,
  };
}

/** A world where only `existing` paths exist and each pane's current
 *  path is `cwd[name]`. Records every question and rewrite. */
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
    ...extra,
  };
  return { deps, retagged, asked };
}

const listed = [{ path: checkout('a') }, { path: checkout('b') }];

function rebind(
  sessions: TaggedSession[],
  deps: MovedSessionDeps,
  held: string[] = []
) {
  return rebindMovedSessions(sessions, ROOT, listed, held, deps);
}

describe('rebindMovedSessions', () => {
  it('rebinds a session whose repository moved, once its pane is in the checkout', () => {
    const { deps, retagged } = world({ a: checkout('a') });
    const [result] = rebind([session('a')], deps);
    expect(retagged).toEqual([
      [
        'a',
        {
          '@orchestra-worktree-path': checkout('a'),
          '@orchestra-repo': ROOT,
        },
      ],
    ]);
    expect(result).toMatchObject({ repo: ROOT, worktreePath: checkout('a') });
  });

  it('leaves a session whose repository or checkout still exists without asking tmux', () => {
    const repoThere = world({ a: checkout('a') }, [OLD]);
    rebind([session('a')], repoThere.deps);
    const checkoutThere = world({ a: checkout('a') }, [oldCheckout('a')]);
    rebind([session('a')], checkoutThere.deps);
    expect([...repoThere.asked, ...checkoutThere.asked]).toEqual([]);
    expect([...repoThere.retagged, ...checkoutThere.retagged]).toEqual([]);
  });

  // The pane path is the foreground job's directory: a job that moved
  // into a sibling checkout is not evidence the session belongs there.
  it('refuses when the pane is in another checkout than the relocated one', () => {
    const { deps, retagged } = world({ a: checkout('b') });
    rebind([session('a')], deps);
    expect(retagged).toEqual([]);
  });

  it('requires the pane in the checkout root, not below it', () => {
    const { deps, retagged } = world({ a: `${checkout('a')}/src` });
    rebind([session('a')], deps);
    expect(retagged).toEqual([]);
  });

  // tmux reports a deleted working directory with this suffix.
  it('refuses a pane whose directory was deleted', () => {
    const { deps, retagged } = world({ a: `${oldCheckout('a')} (deleted)` });
    rebind([session('a')], deps);
    expect(retagged).toEqual([]);
  });

  it('asks nothing when the relocated checkout is not listed', () => {
    const { deps, asked } = world({ gone: checkout('gone') });
    rebind([session('gone')], deps);
    expect(asked).toEqual([]);
  });

  it('asks nothing for a checkout that was outside its repository', () => {
    const { deps, asked } = world({ a: checkout('a') });
    rebind([session('a', '/elsewhere/.claude/worktrees/a')], deps);
    expect(asked).toEqual([]);
  });

  it('refuses a checkout another session claims', () => {
    const { deps, asked } = world({ a: checkout('a') }, [checkout('a')]);
    rebind(
      [session('owner', checkout('a'), { repo: ROOT }), session('a')],
      deps
    );
    expect(asked).toEqual([]);
  });

  // tmux lists by name, while the resolver prefers the oldest: picking
  // either would be a guess.
  it('binds neither of two stale sessions for one checkout', () => {
    const { deps, asked, retagged } = world({
      a: checkout('a'),
      twin: checkout('a'),
    });
    rebind([session('a'), session('twin', oldCheckout('a'))], deps);
    expect(asked).toEqual([]);
    expect(retagged).toEqual([]);
  });

  it('skips a dead pane, a remote session and one this process holds', () => {
    const { deps, asked } = world({
      a: checkout('a'),
      b: checkout('b'),
    });
    rebind(
      [
        session('a', oldCheckout('a'), { paneDead: true }),
        session('b', oldCheckout('b'), { machine: 'peer' }),
      ],
      deps
    );
    const held = session('b');
    rebind([held], deps, [worktreeSessionKey(held.worktreePath, OLD)]);
    expect(asked).toEqual([]);
  });

  it('keeps the old tags when tmux refuses the rewrite', () => {
    const { deps } = world({ a: checkout('a') }, [], { retag: () => false });
    const sessions = [session('a')];
    expect(rebind(sessions, deps)).toEqual(sessions);
  });

  it('ignores terminal sessions', () => {
    const { deps, asked } = world({ t: checkout('a') });
    rebind([session('t', '', { type: 'shell' })], deps);
    expect(asked).toEqual([]);
  });
});
