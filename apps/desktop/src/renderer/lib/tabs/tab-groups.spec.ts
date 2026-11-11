import type { Affiliation } from '@n10/core/ui';
import { placeAffiliation } from '@n10/core/ui';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  homeOpenAmong,
  present,
  presentedIds,
  statusCounts,
  stopOf,
  statusFromActivity,
  tabStopOf,
  type TabFacts,
} from './tab-groups.js';
import { terminalTabId, type Tab } from './tab-identity.js';

const terminal = (name: string): Tab => ({
  id: terminalTabId(name),
  kind: 'terminal',
  name,
  terminalKind: 'agent',
  cwd: `/w/${name}`,
  displayPath: `~/${name}`,
  repo: null,
  preview: false,
  listed: true,
});
const settings: Tab = { id: 'settings', kind: 'settings', preview: false };

const home = (name: string) => ({
  key: name,
  repo: `/w/${name}`,
  worktree: '',
});
const parent = (
  key: string,
  homeName?: string,
  follows?: string
): Affiliation => ({
  kind: 'parent',
  key,
  label: key,
  ...(homeName ? { home: home(homeName) } : {}),
  ...(follows ? { follows } : {}),
});
const place = (path: string) => placeAffiliation(path);

/** Tabs named by their session, each with the affiliation given. */
function strip(
  entries: [string, Affiliation | null][],
  pinned: readonly string[] = [],
  orchestratorsFirst = false
) {
  const tabs = entries.map(([name]) =>
    name === 'settings' ? settings : terminal(name)
  );
  const of = new Map(entries);
  const facts = (tab: Tab): TabFacts =>
    tab.kind === 'terminal'
      ? { affiliation: of.get(tab.name) ?? null, session: tab.name }
      : { affiliation: null };
  return present(tabs, facts, pinned.map(terminalTabId), orchestratorsFirst);
}
const shape = (groups: ReturnType<typeof present>) =>
  groups.map((g) => ({
    key: g.key,
    head: g.head?.id ?? null,
    tabs: g.tabs.map((t) => t.id.replace('terminal:', '')),
    chipped: g.chipped,
  }));

describe('present with pins', () => {
  it('puts pinned tabs first, alone, in their strip order, and out of their groups', () => {
    const groups = strip(
      [
        ['a1', place('/a')],
        ['p1', parent('codex:x')],
        ['a2', place('/a')],
        ['p2', parent('codex:x')],
      ],
      ['p2', 'a1']
    );
    expect(shape(groups)).toEqual([
      { key: 'pin:terminal:a1', head: null, tabs: ['a1'], chipped: false },
      { key: 'pin:terminal:p2', head: null, tabs: ['p2'], chipped: false },
      { key: 'codex:x', head: null, tabs: ['p1'], chipped: false },
      { key: 'place:/a', head: null, tabs: ['a2'], chipped: false },
    ]);
    expect(groups.slice(0, 2).every((g) => g.pinned)).toBe(true);
    // Positional switching walks pins first.
    expect(presentedIds(groups)[0]).toBe('terminal:a1');
  });

  it('leaves the rest of a group whose home is pinned, headless, a chip from two tabs', () => {
    const groups = strip(
      [
        ['conductor', parent('claude:c', 'conductor')],
        ['p1', parent('claude:c', 'conductor')],
        ['p2', parent('claude:c', 'conductor')],
      ],
      ['conductor']
    );
    expect(shape(groups)[1]).toEqual({
      key: 'claude:c',
      head: null,
      tabs: ['p1', 'p2'],
      chipped: true,
    });
  });

  it('finds a headless group’s home among other tabs: pinned, or another pane’s', () => {
    const facts = (tab: Tab): TabFacts =>
      tab.kind === 'terminal'
        ? { affiliation: parent('claude:c', 'conductor'), session: tab.name }
        : { affiliation: null };
    const group = { affiliation: parent('claude:c', 'conductor') };
    const players = [terminal('p1'), terminal('p2')];
    expect(
      homeOpenAmong(group, [...players, terminal('conductor')], facts)
    ).toBe(true);
    expect(homeOpenAmong(group, players, facts)).toBe(false);
    expect(
      homeOpenAmong({ affiliation: parent('codex:x') }, players, facts)
    ).toBe(false);
  });

  it('puts an unpinned tab back in its group where it was', () => {
    const entries: [string, Affiliation | null][] = [
      ['a1', place('/a')],
      ['a2', place('/a')],
      ['a3', place('/a')],
    ];
    expect(shape(strip(entries, ['a2'])).at(-1)?.tabs).toEqual(['a1', 'a3']);
    expect(shape(strip(entries)).at(-1)?.tabs).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('present', () => {
  it('groups by affiliation in the order of each group’s first tab, members in strip order', () => {
    const groups = strip([
      ['a1', place('/a')],
      ['p1', parent('codex:x')],
      ['a2', place('/a')],
      ['settings', null],
      ['p2', parent('codex:x')],
    ]);
    expect(shape(groups)).toEqual([
      { key: 'place:/a', head: null, tabs: ['a1', 'a2'], chipped: true },
      { key: 'codex:x', head: null, tabs: ['p1', 'p2'], chipped: true },
      { key: 'tab:settings', head: null, tabs: ['settings'], chipped: false },
    ]);
    expect(presentedIds(groups)).toEqual([
      'terminal:a1',
      'terminal:a2',
      'terminal:p1',
      'terminal:p2',
      'settings',
    ]);
  });

  it('heads a parent group with its home’s tab, wherever it sits', () => {
    const groups = strip([
      ['p1', parent('claude:c', 'conductor')],
      ['conductor', parent('claude:c', 'conductor')],
    ]);
    expect(shape(groups)).toEqual([
      {
        key: 'claude:c',
        head: 'terminal:conductor',
        tabs: ['conductor', 'p1'],
        chipped: true,
      },
    ]);
  });

  it('chips a group of two tabs or more, a parent’s or a place’s, and no group of one', () => {
    const groups = strip([
      ['only', parent('codex:x')],
      ['notes', place('/notes')],
      ['conductor', parent('claude:c', 'conductor')],
      ['p1', parent('claude:c', 'conductor')],
      ['a1', place('/a')],
      ['a2', place('/a')],
    ]);
    expect(groups.map((g) => g.chipped)).toEqual([false, false, true, true]);
  });

  it('leads with the groups orchestrators head while the pane is not arranged by hand', () => {
    const entries: [string, Affiliation | null][] = [
      ['notes', place('/notes')],
      ['p1', parent('codex:x')],
      ['solo', parent('claude:s', 'solo')],
      ['conductor', parent('claude:c', 'conductor')],
      ['c1', parent('claude:c', 'conductor')],
    ];
    expect(strip(entries, [], true).map((g) => g.key)).toEqual([
      'claude:s',
      'claude:c',
      'place:/notes',
      'codex:x',
    ]);
    expect(strip(entries).map((g) => g.key)).toEqual([
      'place:/notes',
      'codex:x',
      'claude:s',
      'claude:c',
    ]);
  });

  it('keeps pinned tabs ahead of the orchestrators it leads with', () => {
    const groups = strip(
      [
        ['notes', place('/notes')],
        ['conductor', parent('claude:c', 'conductor')],
      ],
      ['notes'],
      true
    );
    expect(groups.map((g) => g.key)).toEqual([
      'pin:terminal:notes',
      'claude:c',
    ]);
  });

  it('puts a group whose home reports to another right after that one’s', () => {
    const groups = strip([
      ['sub', parent('codex:sub', 'sub', 'claude:top')],
      ['sub2', parent('codex:sub', 'sub', 'claude:top')],
      ['a', place('/a')],
      ['top', parent('claude:top', 'top')],
      ['top2', parent('claude:top', 'top')],
      ['b', place('/b')],
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      'place:/a',
      'claude:top',
      'codex:sub',
      'place:/b',
    ]);
  });

  it('follows its parent whichever of its tabs comes first', () => {
    // Every member carries the group's `follows`; a player first.
    const sub = parent('codex:sub', 'sub', 'claude:top');
    const groups = strip([
      ['leaf', sub],
      ['other', place('/other')],
      ['top', parent('claude:top', 'top')],
      ['top2', parent('claude:top', 'top')],
      ['sub', sub],
    ]);
    expect(groups.map((g) => [g.key, g.behind])).toEqual([
      ['place:/other', undefined],
      ['claude:top', undefined],
      ['codex:sub', 'claude:top'],
    ]);
  });

  it('places a group of one tab by its own order, following no one', () => {
    const groups = strip([
      ['sub', parent('codex:sub', 'sub', 'claude:top')],
      ['a', place('/a')],
      ['top', parent('claude:top', 'top')],
      ['top2', parent('claude:top', 'top')],
    ]);
    expect(groups.map((g) => [g.key, g.behind])).toEqual([
      ['codex:sub', undefined],
      ['place:/a', undefined],
      ['claude:top', undefined],
    ]);
  });

  it('breaks a cycle of parents at the group that comes first', () => {
    const groups = strip([
      ['x', parent('codex:x', 'x', 'codex:y')],
      ['x2', parent('codex:x', 'x', 'codex:y')],
      ['y', parent('codex:y', 'y', 'codex:x')],
      ['y2', parent('codex:y', 'y', 'codex:x')],
    ]);
    expect(groups.map((g) => g.key)).toEqual(['codex:x', 'codex:y']);
  });

  it('puts a follower of a cycle after the cycle’s first member', () => {
    const groups = strip([
      ['c', parent('codex:c', 'c', 'codex:a')],
      ['c2', parent('codex:c', 'c', 'codex:a')],
      ['a', parent('codex:a', 'a', 'codex:b')],
      ['a2', parent('codex:a', 'a', 'codex:b')],
      ['b', parent('codex:b', 'b', 'codex:a')],
      ['b2', parent('codex:b', 'b', 'codex:a')],
    ]);
    expect(groups.map((g) => g.key)).toEqual(['codex:a', 'codex:c', 'codex:b']);
  });
});

describe('tabStopOf', () => {
  const groups = strip([
    ['solo', place('/solo')],
    ['h', parent('claude:x', 'h')],
    ['p1', parent('claude:x')],
    ['p2', parent('claude:x')],
    ['z', place('/z')],
  ]);
  it('is the active tab when it stands alone', () => {
    expect(tabStopOf(groups, terminalTabId('z'))).toBe(terminalTabId('z'));
  });
  it('is its group’s chip for a member, home or player', () => {
    expect(tabStopOf(groups, terminalTabId('p2'))).toBe('chip:claude:x');
    expect(tabStopOf(groups, terminalTabId('h'))).toBe('chip:claude:x');
  });
  it('is the first block with no active tab', () => {
    expect(tabStopOf(groups, null)).toBe(terminalTabId('solo'));
    expect(stopOf(groups[0]!)).toBe(terminalTabId('solo'));
  });
});

describe('status', () => {
  it('says new output for flashing and working for active, never done', () => {
    expect(statusFromActivity({ active: true, flashing: true })).toBe(
      'new-output'
    );
    expect(statusFromActivity({ active: true, flashing: false })).toBe(
      'working'
    );
    expect(statusFromActivity(undefined)).toBe('idle');
  });
  it('counts each state present, worst first', () => {
    expect(
      statusCounts(['working', 'idle', 'new-output', 'working', 'blocked'])
    ).toEqual([
      { status: 'blocked', count: 1 },
      { status: 'new-output', count: 1 },
      { status: 'working', count: 2 },
      { status: 'idle', count: 1 },
    ]);
  });
});

describe('present (properties)', () => {
  const KEYS = ['codex:a', 'codex:b', 'codex:c', 'place:/p'];
  const PARENTS = KEYS.filter((k) => !k.startsWith('place:'));
  /** Tabs in some order, each in one of `KEYS`; each parent group may
   *  follow another, as all its members say. */
  const strips = fc
    .record({
      keys: fc.array(fc.constantFrom(...KEYS), { maxLength: 10 }),
      follows: fc.tuple(
        ...PARENTS.map(() =>
          fc.option(fc.constantFrom(...PARENTS), { nil: undefined })
        )
      ),
    })
    .map(({ keys, follows }) => {
      const parentOf = new Map(
        PARENTS.map((k, i) => [k, follows[i] === k ? undefined : follows[i]])
      );
      const groups = strip(
        keys.map((key, i) => [
          `t${i}`,
          key.startsWith('place:')
            ? place('/p')
            : parent(key, undefined, parentOf.get(key)),
        ])
      );
      return { keys, parentOf, groups };
    });

  it('presents every tab exactly once, whatever the parents follow', () => {
    fc.assert(
      fc.property(strips, ({ keys, groups }) => {
        expect([...presentedIds(groups)].sort()).toEqual(
          keys.map((_, i) => terminalTabId(`t${i}`)).sort()
        );
      })
    );
  });

  it('shows a follower after its parent, unless both are in one cycle', () => {
    fc.assert(
      fc.property(strips, ({ parentOf, groups }) => {
        const at = new Map(groups.map((g, i) => [g.key, i]));
        const reaches = (from: string, to: string) => {
          const seen = new Set<string>();
          for (
            let k = parentOf.get(from);
            k && !seen.has(k);
            k = parentOf.get(k)
          ) {
            if (k === to) return true;
            seen.add(k);
          }
          return false;
        };
        const chipped = new Set(
          groups.filter((g) => g.chipped).map((g) => g.key)
        );
        const misplaced = groups.filter((g) => {
          const up = parentOf.get(g.key);
          if (!up || !at.has(up) || reaches(up, g.key)) return false;
          // Only a chip follows a chip.
          if (!chipped.has(g.key) || !chipped.has(up)) return false;
          return at.get(up)! > at.get(g.key)!;
        });
        expect(misplaced.map((g) => g.key)).toEqual([]);
      })
    );
  });
});
