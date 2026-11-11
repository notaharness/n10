import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { homelessLabel, parentTarget, placeKey } from '../affiliation.js';
import { registryNameOf, type TaggedSession } from '../session-identity.js';
import { mainCheckoutOf } from '../repository.js';
import { affiliations, checkoutKey } from './affiliations.js';

const CLAUDE = 'claude:7c0ffee0-1234-4abc-8def-0123456789ab';
const CODEX = 'codex:11111111-2222-3333-4444-555555555555';
const PEER = '1234567890abcdef1234567890abcdef';
const SELF = 'feedfacefeedfacefeedfacefeedface';
const REPO = '/home/u/repo';

let created = 0;
function shell(name: string, tags: Partial<TaggedSession> = {}): TaggedSession {
  return {
    name,
    created: ++created,
    paneDead: false,
    path: `/home/u/${name}`,
    spawner: 'n10',
    repo: `/home/u/${name}`,
    type: 'shell',
    branch: '',
    worktreePath: '',
    machine: 'local',
    identityTags: {},
    ...tags,
  };
}
function player(
  branch: string,
  orchestrator: string | undefined,
  tags: Partial<TaggedSession> = {}
): TaggedSession {
  const worktreePath = `${REPO}/.claude/worktrees/${branch}`;
  return shell(`repo-${branch}`, {
    spawner: 'orchestra',
    type: 'worktree',
    repo: REPO,
    path: worktreePath,
    branch,
    worktreePath,
    ...(orchestrator ? { orchestrator } : {}),
    ...tags,
  });
}

/** A directory's place: `/home/u/repo/...` is the repository, anything
 *  else itself. */
const placeOf = (dir: string) => (dir.startsWith(`${REPO}/`) ? REPO : dir);
const of = (sessions: TaggedSession[]) =>
  affiliations(sessions, placeOf, { self: SELF }).sessions;
const key = registryNameOf;

describe('affiliations', () => {
  it('groups players under the session whose target they report to', () => {
    const home = shell('conductor', { target: CLAUDE });
    const a = player('a', CLAUDE);
    const b = player('b', CLAUDE);
    const groups = of([a, home, b]);
    const head = {
      kind: 'parent',
      key: CLAUDE,
      label: 'conductor',
      home: { key: key(home), repo: home.repo, worktree: '', place: home.path },
      place: home.path,
    };
    expect(groups.get(key(home))).toEqual(head);
    expect(groups.get(key(a))).toEqual(head);
    expect(groups.get(key(b))).toEqual(head);
  });

  it('heads a group for a marked orchestrator with no players', () => {
    const home = shell('conductor', { target: CODEX });
    expect(of([home]).get(key(home))).toMatchObject({
      kind: 'parent',
      key: CODEX,
    });
  });

  it('strips the beam qualifier so a remote player joins the same group', () => {
    const home = shell('conductor', { target: CLAUDE });
    const remote = player('r', `beam:${PEER}/${CLAUDE}`, { machine: PEER });
    expect(of([home, remote]).get(key(remote))).toMatchObject({
      key: CLAUDE,
      home: { key: key(home) },
    });
  });

  it('finds a tmux: parent by name, keyed by its target when it has one', () => {
    const named = shell('boss');
    const marked = shell('marked', { target: CLAUDE });
    const a = player('a', 'tmux:boss');
    const b = player('b', 'tmux:marked');
    const c = player('c', CLAUDE);
    const groups = of([named, marked, a, b, c]);
    expect(groups.get(key(a))).toMatchObject({
      key: 'tmux:boss',
      label: 'boss',
      place: named.path,
    });
    expect(groups.get(key(named))).toMatchObject({ key: 'tmux:boss' });
    expect(groups.get(key(b))?.key).toBe(CLAUDE);
    expect(groups.get(key(c))?.key).toBe(CLAUDE);
  });

  it('does not find a tmux: parent among another machine’s sessions', () => {
    const remoteBoss = shell('boss', { machine: PEER });
    const a = player('a', 'tmux:boss');
    const groups = of([remoteBoss, a]);
    expect(groups.get(key(a))).toEqual({
      kind: 'parent',
      key: 'tmux:boss',
      label: 'boss',
      place: REPO,
    });
    expect(groups.get(key(remoteBoss))?.kind).toBe('place');
  });

  it('finds a remote player’s tmux: parent on the player’s own machine', () => {
    const localBoss = shell('boss');
    const remoteBoss = shell('boss', { machine: PEER });
    const remote = player('r', 'tmux:boss', { machine: PEER });
    const groups = of([localBoss, remoteBoss, remote]);
    const head = {
      kind: 'parent',
      key: `beam:${PEER}/tmux:boss`,
      label: 'boss',
      home: {
        key: key(remoteBoss),
        repo: remoteBoss.repo,
        worktree: '',
        place: remoteBoss.path,
      },
      place: remoteBoss.path,
    };
    expect(groups.get(key(remote))).toEqual(head);
    expect(groups.get(key(remoteBoss))).toEqual(head);
    expect(groups.get(key(localBoss))?.kind).toBe('place');
  });

  it('finds a qualified tmux: parent on the machine the qualifier names', () => {
    const localBoss = shell('boss');
    const remoteBoss = shell('boss', { machine: PEER });
    const toHere = player('h', `beam:${SELF}/tmux:boss`, { machine: PEER });
    const toThere = player('t', `beam:${PEER}/tmux:boss`);
    const groups = of([localBoss, remoteBoss, toHere, toThere]);
    expect(groups.get(key(toHere))).toMatchObject({
      key: 'tmux:boss',
      home: { key: key(localBoss) },
    });
    expect(groups.get(key(toThere))).toMatchObject({
      home: { key: key(remoteBoss) },
    });
  });

  it('keeps homeless tmux: parents on different machines apart', () => {
    const here = player('h', 'tmux:main');
    const there = player('t', 'tmux:main', { machine: PEER });
    const groups = of([here, there]);
    expect(groups.get(key(here))?.key).toBe('tmux:main');
    expect(groups.get(key(there))).toEqual({
      kind: 'parent',
      key: `beam:${PEER}/tmux:main`,
      label: 'main',
      place: REPO,
    });
  });

  it('labels a homeless parent by harness and its players’ common place', () => {
    const a = player('a', CODEX);
    const b = player('b', CODEX);
    expect(of([a, b]).get(key(a))).toEqual({
      kind: 'parent',
      key: CODEX,
      label: 'Codex · repo',
      place: REPO,
    });
    const elsewhere = shell('notes', { type: 'agent', orchestrator: CODEX });
    expect(of([a, elsewhere]).get(key(a))?.label).toBe('Codex');
  });

  it('heads its own group, after its parent’s, for an orchestrator that reports to one', () => {
    const top = shell('top', { target: CLAUDE });
    const middle = shell('middle', { target: CODEX, orchestrator: CLAUDE });
    const leaf = player('leaf', CODEX);
    const groups = of([top, middle, leaf]);
    expect(groups.get(key(middle))).toMatchObject({
      key: CODEX,
      follows: CLAUDE,
      home: { key: key(middle) },
    });
    // One group, one affiliation: its players follow too.
    expect(groups.get(key(leaf))).toEqual(groups.get(key(middle)));
    expect(groups.get(key(top))).not.toHaveProperty('follows');
  });

  it('ignores a session reporting to itself', () => {
    const self = shell('loop', { target: CLAUDE, orchestrator: CLAUDE });
    expect(of([self]).get(key(self))).not.toHaveProperty('follows');
    // Property counterexample: a shell naming itself by `tmux:`.
    const byName = shell('s1', { orchestrator: 'tmux:s1' });
    expect(of([byName]).get(key(byName))?.kind).toBe('place');
  });

  it('gives a terminal in a player’s checkout the player’s parent', () => {
    const a = player('a', CODEX);
    const term = shell('a-shell', { path: `${a.worktreePath}/` });
    const result = affiliations([a, term], placeOf);
    expect(result.sessions.get(key(term))?.key).toBe(CODEX);
    expect(result.worktrees.get(checkoutKey(a.worktreePath))?.key).toBe(CODEX);
  });

  it('gives a terminal anywhere in a checkout the innermost checkout’s parent', () => {
    // A player in the main checkout, another in a worktree nested in it.
    const outer = player('main', CLAUDE, { path: REPO, worktreePath: REPO });
    const inner = player('a', CODEX);
    const deep = shell('deep', { path: `${inner.worktreePath}/apps/x` });
    const beside = shell('beside', { path: `${REPO}/apps/x` });
    const sibling = shell('sibling', { path: `${inner.worktreePath}-b` });
    const far = shell('far', {
      machine: PEER,
      path: `${inner.worktreePath}/x`,
    });
    const groups = of([outer, inner, deep, beside, sibling, far]);
    expect(groups.get(key(deep))?.key).toBe(CODEX);
    expect(groups.get(key(beside))?.key).toBe(CLAUDE);
    // A name that only starts like the checkout's is not inside it.
    expect(groups.get(key(sibling))?.key).toBe(CLAUDE);
    // Another machine's directory is not this machine's checkout.
    expect(groups.get(key(far))?.kind).toBe('place');
  });

  it('puts everything else in its place: the main checkout, else the directory', () => {
    const wt = player('plain', undefined);
    const inRepo = shell('repo-shell', { path: `${REPO}/apps/x` });
    const loose = shell('loose');
    const remote = shell('far', { machine: PEER, path: '/srv/far' });
    const groups = of([wt, inRepo, loose, remote]);
    expect(groups.get(key(wt))).toEqual({
      kind: 'place',
      key: placeKey(REPO),
      label: 'repo',
      place: REPO,
    });
    expect(groups.get(key(inRepo))?.key).toBe(placeKey(REPO));
    expect(groups.get(key(loose))).toEqual({
      kind: 'place',
      key: placeKey('/home/u/loose'),
      label: 'loose',
      place: '/home/u/loose',
    });
    expect(groups.get(key(remote))?.key).toBe(placeKey('/srv/far', PEER));
  });
});

describe('affiliation keys', () => {
  it('strips a qualifier from a global id, and keeps a tmux name’s machine', () => {
    expect(parentTarget(`beam:${PEER}/codex:x`).key).toBe('codex:x');
    expect(parentTarget('tmux:beam:x/y').key).toBe('tmux:beam:x/y');
    expect(parentTarget('tmux:a', PEER).key).toBe(`beam:${PEER}/tmux:a`);
    expect(parentTarget(`beam:${SELF}/tmux:a`, PEER, SELF)).toEqual({
      key: 'tmux:a',
      tmux: { machine: 'local', name: 'a' },
    });
  });

  it('names a tmux parent by its session', () => {
    expect(homelessLabel('tmux:boss', ['a', 'b'])).toBe('boss');
    expect(homelessLabel(`beam:${PEER}/tmux:boss`, [])).toBe('boss');
    expect(homelessLabel('other:x', ['a'])).toBe('other · a');
  });
});

describe('mainCheckoutOf', () => {
  it('answers null outside a repository', () => {
    expect(mainCheckoutOf('/')).toBeNull();
  });

  it('answers a submodule’s own checkout, not its Git directory', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'n10-submodule-')));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=n10',
          '-c',
          'user.email=n10@example.invalid',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'protocol.file.allow=always',
          ...args,
        ],
        { cwd, stdio: 'ignore' }
      );
    try {
      for (const name of ['lib', 'app']) {
        mkdirSync(join(root, name));
        git(join(root, name), 'init', '-q');
        git(join(root, name), 'commit', '-q', '--allow-empty', '-m', 'x');
      }
      const app = join(root, 'app');
      git(app, 'submodule', 'add', '-q', join(root, 'lib'), 'lib');
      expect(mainCheckoutOf(join(app, 'lib'))).toBe(join(app, 'lib'));
      expect(mainCheckoutOf(app)).toBe(app);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
