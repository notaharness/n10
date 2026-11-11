import { describe, expect, it } from 'vitest';
import { terminalTabId, type Tab } from './tab-identity.js';
import { rosterEntries, type RosterEntry } from './roster-order.js';

const player = (name: string): { tab: Tab } => ({
  tab: {
    id: `item:${name}`,
    kind: 'item',
    repo: '/r',
    itemKey: `branch:${name}`,
    preview: false,
    worktree: `/r/.claude/worktrees/${name}`,
  },
});
const shell = (name: string, cwd: string): { tab: Tab } => ({
  tab: {
    id: terminalTabId(name),
    kind: 'terminal',
    name,
    terminalKind: 'shell',
    cwd,
    displayPath: cwd,
    repo: null,
    preview: false,
    listed: true,
  },
});
const rows = (entries: RosterEntry<{ tab: Tab }>[]) =>
  entries.map((e) => [e.face.tab.id, e.depth]);

describe('rosterEntries', () => {
  const home = shell('conductor', '/r');
  const a = player('a');
  const b = player('b');
  const aShell = shell('a-shell', '/r/.claude/worktrees/a/src');

  it('heads an orchestrator’s group with its home, players under it, each player’s tabs under that', () => {
    const entries = rosterEntries([a, b, home, aShell], home.tab.id, true);
    expect(rows(entries)).toEqual([
      ['terminal:conductor', 0],
      ['item:a', 1],
      ['terminal:a-shell', 2],
      ['item:b', 1],
    ]);
  });

  it('lists a group with no home here flat, players’ tabs still under them', () => {
    expect(rows(rosterEntries([aShell, b, a], undefined, true))).toEqual([
      ['item:b', 0],
      ['item:a', 0],
      ['terminal:a-shell', 1],
    ]);
  });

  it('keeps a place group flat, in strip order', () => {
    expect(rows(rosterEntries([a, aShell], undefined, false))).toEqual([
      ['item:a', 0],
      ['terminal:a-shell', 0],
    ]);
  });

  it('does not take a sibling directory sharing a prefix for the worktree', () => {
    const other = shell('ab', '/r/.claude/worktrees/ab');
    expect(rows(rosterEntries([a, other], undefined, true))).toEqual([
      ['item:a', 0],
      ['terminal:ab', 0],
    ]);
  });
});

describe('rosterEntries tree guides', () => {
  const home = shell('conductor', '/r');
  const a = player('a');
  const b = player('b');
  const aShell = shell('a-shell', '/r/.claude/worktrees/a/src');
  const guides = (entries: ReturnType<typeof rosterEntries<{ tab: Tab }>>) =>
    entries.map((e) => [e.face.tab.id, e.tree]);

  it('turns a corner at the last of each level, and runs the home’s guide past a player with more below', () => {
    expect(
      guides(rosterEntries([a, aShell, b, home], home.tab.id, true))
    ).toEqual([
      ['terminal:conductor', { last: true, branches: true, through: [] }],
      ['item:a', { last: false, branches: true, through: [] }],
      ['terminal:a-shell', { last: true, branches: false, through: [true] }],
      ['item:b', { last: true, branches: false, through: [] }],
    ]);
  });

  it('draws none for a place group', () => {
    expect(
      rosterEntries([a, aShell], undefined, false).every((e) => !e.tree)
    ).toBe(true);
  });
});
