import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PullRequestInfo } from '@n10/vcs-core';
import type { SidebarItem } from '../../../host/contract.js';
import {
  collisionLabel as resolveCollisionLabel,
  cutSide,
  placeLabels,
  repoDisplayName,
  tabPresentation,
  tabRepo,
} from './tab-presentation.js';
import { itemTabId, terminalTabId } from './tab-identity.js';
import type { ItemTab, Tab } from './tabs-model.js';

const A = '/repos/alpha';
const collisionLabel = (...args: Parameters<typeof resolveCollisionLabel>) =>
  resolveCollisionLabel(...args).label;

const item = (repo: string, itemKey: string): Tab => ({
  id: itemTabId(repo, itemKey),
  kind: 'item',
  repo,
  itemKey,
  preview: false,
});

describe('collisionLabel', () => {
  it('uses branches for equal task titles', () => {
    const a = { ...item(A, 'branch:feature/login'), branch: 'feature/login' };
    const b = { ...item(A, 'branch:feature/token'), branch: 'feature/token' };
    const peers = [a, b];
    expect(
      collisionLabel(
        a,
        peers,
        () => 'Fix auth',
        peers.map((t) => t.id)
      )
    ).toBe('Fix auth · feature/login');
    expect(
      collisionLabel(
        b,
        peers,
        () => 'Fix auth',
        peers.map((t) => t.id)
      )
    ).toBe('Fix auth · feature/token');
  });

  it('uses stable open ordinals for identical shells', () => {
    const a = terminal('a', A, A);
    const b = terminal('b', A, A);
    const order = [b.id, a.id];
    expect(collisionLabel(a, [a, b], () => 'forge', order)).toBe('forge · 2');
    expect(collisionLabel(b, [a, b], () => 'forge', order)).toBe('forge · 1');
    expect(collisionLabel(b, [b, a], () => 'forge', order)).toBe('forge · 1');
    expect(
      collisionLabel(
        b,
        [b],
        () => 'forge',
        order,
        () => ({ base: 'forge', ordinal: 1 })
      )
    ).toBe('forge');
  });

  it('does not reuse an ordinal still held after a shell closes', () => {
    const a = terminal('a', A, A);
    const b = terminal('b', A, A);
    const c = terminal('c', A, A);
    const held = new Map<string, { base: string; ordinal: number }>();
    const label = (tab: Tab, peers: Tab[], order: string[]) =>
      collisionLabel(
        tab,
        peers,
        () => 'forge',
        order,
        (id) => held.get(id)
      );

    expect(label(b, [b, a], [b.id, a.id])).toBe('forge · 1');
    held.set(b.id, { base: 'forge', ordinal: 1 });
    expect(label(a, [b, a], [b.id, a.id])).toBe('forge · 2');
    held.set(a.id, { base: 'forge', ordinal: 2 });

    held.delete(b.id);
    expect(label(a, [a, c], [a.id, c.id])).toBe('forge · 2');
    expect(label(c, [a, c], [a.id, c.id])).toBe('forge · 1');
  });

  it('drops a held ordinal when the base label changes', () => {
    const a = terminal('a', A, A);
    const b = terminal('b', A, A);
    const held = {
      [a.id]: { base: 'forge', ordinal: 1 },
      [b.id]: { base: 'forge', ordinal: 2 },
    };
    const name = (tab: Tab) => (tab.id === a.id ? 'Fix auth' : 'Write docs');
    expect(
      resolveCollisionLabel(a, [a, b], name, [a.id, b.id], (id) => held[id])
        .label
    ).toBe('Fix auth');
    expect(
      resolveCollisionLabel(b, [a, b], name, [a.id, b.id], (id) => held[id])
        .label
    ).toBe('Write docs');
  });

  it('never reads a numeric directory suffix as an allocated ordinal', () => {
    const a = terminal('a', A, A);
    expect(resolveCollisionLabel(a, [a], () => 'forge · 2', [a.id])).toEqual({
      label: 'forge · 2',
    });
  });

  it('gives open duplicate shells distinct full labels', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), {
          minLength: 2,
          maxLength: 12,
        }),
        (names) => {
          const peers = names.map((name) => terminal(name, A, A));
          const labels = peers.map((tab) =>
            collisionLabel(
              tab,
              peers,
              () => 'forge',
              peers.map((peer) => peer.id)
            )
          );
          expect(new Set(labels).size).toBe(peers.length);
        }
      )
    );
  });
});

it('disambiguates equal place basenames with the shortest parent suffix', () => {
  const labels = placeLabels([
    '/code/work/forge',
    '/code/personal/forge',
    '/code/n10',
  ]);
  expect(labels.get('/code/work/forge')).toBe('work/forge');
  expect(labels.get('/code/personal/forge')).toBe('personal/forge');
  expect(labels.get('/code/n10')).toBe('n10');
});

const settings: Tab = { id: 'settings', kind: 'settings', preview: false };

const terminal = (name: string, repo: string | null, cwd = '/x'): Tab => ({
  id: terminalTabId(name),
  kind: 'terminal',
  name,
  terminalKind: 'shell',
  cwd,
  displayPath: cwd,
  repo,
  preview: false,
  listed: true,
});

describe('repoDisplayName', () => {
  it('is the checkout directory name', () => {
    expect(repoDisplayName('/home/dev/code/n10')).toBe('n10');
  });

  it('ignores a trailing separator', () => {
    expect(repoDisplayName('/home/dev/code/n10/')).toBe('n10');
  });

  it('handles a Windows path', () => {
    expect(repoDisplayName('C:\\src\\n10')).toBe('n10');
  });

  it('falls back to the path when there is nothing to take', () => {
    expect(repoDisplayName('/')).toBe('/');
  });
});

describe('tabRepo', () => {
  it('names an item tab’s repository', () => {
    expect(tabRepo(item(A, 'branch:x'))).toBe(A);
  });

  it('is null for settings', () => {
    expect(tabRepo(settings)).toBeNull();
  });

  it('is the terminal’s repository, or null for a plain folder', () => {
    expect(tabRepo(terminal('t', A))).toBe(A);
    expect(tabRepo(terminal('t', null))).toBeNull();
  });
});

describe('cutSide', () => {
  it('cuts branch names and directories from the start, titles from the end', () => {
    expect(cutSide('branch')).toBe('start');
    expect(cutSide('terminal')).toBe('start');
    expect(cutSide('pr')).toBe('end');
    expect(cutSide('settings')).toBe('end');
  });
});

describe('tabPresentation', () => {
  const pr = { id: 42, title: 'Add undo support' } as PullRequestInfo;
  const withPr: SidebarItem = {
    kind: 'session',
    session: { name: 'feat-undo', running: false },
    pr,
    branch: 'feat-undo',
    isMerged: false,
  };
  const bare: SidebarItem = {
    kind: 'session',
    session: { name: 'feat-undo', running: false },
    branch: 'feat-undo',
    isMerged: false,
  };
  const tab = (extra: Partial<ItemTab> = {}): Tab => ({
    ...(item(A, 'pr:42') as ItemTab),
    ...extra,
  });

  it('names a tab after its pull request while the item is at hand', () => {
    expect(tabPresentation(tab(), withPr)).toMatchObject({
      label: 'alpha · Add undo support',
      face: 'pr',
    });
    expect(
      tabPresentation(tab({ itemKey: 'branch:feat-undo' }), bare)
    ).toMatchObject({ label: 'alpha · feat-undo', face: 'branch' });
  });

  it('keeps the stamped title once the item is out of reach', () => {
    // A tab of another repository: this sidebar has no row for it, and
    // the strip must not fall back to "42".
    const foreign = tab({ title: 'Add undo support', branch: 'feat-undo' });
    expect(tabPresentation(foreign, undefined)).toMatchObject({
      label: 'alpha · Add undo support',
      face: 'pr',
    });
  });

  it('falls back to the PR number when its title is unavailable', () => {
    expect(tabPresentation(tab({ branch: 'feat-undo' }), undefined).label).toBe(
      'alpha · PR #42'
    );
    expect(tabPresentation(tab(), undefined).label).toBe('alpha · PR #42');
  });

  it('shows a terminal by its directory basename', () => {
    expect(
      tabPresentation(
        terminal('t', null, '~/Documents/Code/Personal/n10'),
        undefined
      )
    ).toMatchObject({ label: 'n10', face: 'terminal' });
  });

  it('names the settings tab', () => {
    const settings: Tab = { id: 'settings', kind: 'settings', preview: false };
    expect(tabPresentation(settings, undefined)).toMatchObject({
      label: 'Settings',
      face: 'settings',
    });
  });

  // ux-machines.md §6 / D8: the machine, resolved by the caller, comes
  // first — and is entirely absent for a local tab.
  describe('machine prefix (D8)', () => {
    const branchTab = tab({ itemKey: 'branch:feat-undo', branch: 'feat-undo' });

    it('is unprefixed for a local tab — no machineLabel argument at all', () => {
      expect(tabPresentation(branchTab, undefined)).toMatchObject({
        label: 'alpha · feat-undo',
        face: 'branch',
      });
    });

    it('is unprefixed when the caller explicitly passes null (local)', () => {
      expect(tabPresentation(branchTab, undefined, null)).toMatchObject({
        label: 'alpha · feat-undo',
        face: 'branch',
      });
    });

    it('puts a remote machine label first, separated by " · "', () => {
      expect(tabPresentation(branchTab, undefined, 'workbox')).toMatchObject({
        label: 'workbox · alpha · feat-undo',
        face: 'branch',
      });
    });

    it('prefixes a terminal tab’s directory label the same way', () => {
      expect(
        tabPresentation(terminal('t', null, '~/x'), undefined, 'workbox')
      ).toMatchObject({ label: 'workbox · x', face: 'terminal' });
    });

    it('never prefixes settings, even if a caller passed a label', () => {
      const settings: Tab = {
        id: 'settings',
        kind: 'settings',
        preview: false,
      };
      expect(tabPresentation(settings, undefined, 'workbox')).toMatchObject({
        label: 'Settings',
        face: 'settings',
      });
    });
  });
});

describe('context labels', () => {
  it('keeps a shell basename in both grouped and singleton places', () => {
    const shell = terminal('shell', '/code/forge', '/code/forge');
    expect(
      tabPresentation(shell, undefined, null, { chipped: true }).label
    ).toBe('forge');
    expect(tabPresentation(shell, undefined).label).toBe('forge');
    expect(
      tabPresentation(shell, undefined, null, { place: 'work/forge' }).label
    ).toBe('work/forge');
    expect(
      tabPresentation(shell, undefined, null, { taskTitle: 'Ignore me' }).source
    ).toBe('dir');
  });

  it('drops the selected repository from a grouped branch label', () => {
    const branch = { ...item('/code/forge', 'branch:build'), branch: 'build' };
    expect(
      tabPresentation(branch, undefined, null, { chipped: true }).label
    ).toBe('build');
  });

  it('uses a task title, then the branch, for an agent', () => {
    const agent = {
      ...item('/code/forge', 'branch:feature/forms'),
      branch: 'feature/forms',
    };
    expect(
      tabPresentation(agent, undefined, null, { chipped: true }).label
    ).toBe('feature/forms');
    expect(
      tabPresentation(agent, undefined, null, {
        chipped: true,
        taskTitle: 'Fix auth',
      })
    ).toMatchObject({ label: 'Fix auth', source: 'task' });
    expect(
      tabPresentation(agent, undefined, 'workbox', {
        chipped: true,
        taskTitle: 'Fix auth',
      }).label
    ).toBe('workbox · Fix auth');
  });

  it('uses place for a lone directory and keeps PR title ahead of task', () => {
    expect(
      tabPresentation(
        terminal('notes', null, '/home/dev/Documents/notes'),
        undefined
      ).label
    ).toBe('notes');
    const pr = { ...item('/code/forge', 'pr:42'), branch: 'feature/forms' };
    expect(
      tabPresentation(pr, undefined, null, { taskTitle: 'Other task' }).label
    ).toBe('forge · PR #42');
    expect(
      tabPresentation(pr, undefined, null, { taskTitle: 'Other task' }).source
    ).toBe('pr');
  });

  it('names the home directory and empty terminal paths meaningfully', () => {
    expect(
      tabPresentation(terminal('home', null, '/home/dev'), undefined).label
    ).toBe('Home');
    expect(tabPresentation(terminal('empty', null, ''), undefined).label).toBe(
      'Terminal'
    );
    const agent = terminal('agent', null, '') as Extract<
      Tab,
      { kind: 'terminal' }
    >;
    expect(
      tabPresentation({ ...agent, terminalKind: 'agent' }, undefined).label
    ).toBe('Agent');
  });
});
