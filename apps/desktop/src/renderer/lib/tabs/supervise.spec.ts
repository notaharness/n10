import { describe, expect, it } from 'vitest';
import { itemTabId } from './tab-identity.js';
import {
  EMPTY_WORKSPACE,
  reduce,
  type ItemEntry,
  type TabsAction,
  type Workspace,
} from './tabs-model.js';
import { followEdge, tileEdge } from './supervise.js';
import { toSaved } from './workspace-file.js';
import { panesOf } from './workspace.js';

const REPO = '/repos/alpha';
const id = (key: string) => itemTabId(REPO, `branch:${key}`);
const open = (key: string): TabsAction => ({
  type: 'open-item',
  repo: REPO,
  itemKey: `branch:${key}`,
  preview: false,
});
const then = (ws: Workspace, ...actions: TabsAction[]) =>
  actions.reduce(reduce, ws);
const run = (...actions: TabsAction[]) => then(EMPTY_WORKSPACE, ...actions);
const short = (tabId: string | null) => tabId?.split(':').at(-1) ?? null;

/** Each pane's tabs (by branch) and the one it shows. */
const shape = (ws: Workspace) =>
  panesOf(ws.layout).map((p) => ({
    id: p.id,
    order: p.order.map(short),
    active: short(p.activeId),
  }));

/** The orchestrator's tab `home`, three players, and an unrelated tab;
 *  `p2` is active. */
const group = () =>
  run(open('home'), open('p1'), open('other'), open('p2'), open('p3'), {
    type: 'activate',
    id: id('p2'),
  });
const players = [id('p1'), id('p2'), id('p3')];
const KEY = 'claude:boss';

const tile = (edge: 'right' | 'bottom' = 'right'): TabsAction => ({
  type: 'tile-group',
  pane: 'pane-1',
  key: KEY,
  home: id('home'),
  players,
  edge,
});

describe('tiling a group', () => {
  it('moves the players to a new pane, keeping the home and the rest', () => {
    const ws = then(group(), tile());
    expect(shape(ws)).toEqual([
      { id: 'pane-1', order: ['home', 'other'], active: 'home' },
      { id: 'pane-2', order: ['p1', 'p2', 'p3'], active: 'p2' },
    ]);
    expect(ws.layout.kind === 'split' && ws.layout.direction).toBe('row');
    expect(ws.layout.kind === 'split' && ws.layout.sizes).toEqual([0.5, 0.5]);
    // The source keeps focus, for supervision.
    expect(ws.focusedPane).toBe('pane-1');
    expect(Object.keys(ws.tabs)).toHaveLength(5);
  });

  it('shows the first player when the source showed none of them', () => {
    const ws = then(group(), { type: 'activate', id: id('other') }, tile());
    expect(shape(ws)[1]!.active).toBe('p1');
  });

  it('splits below on request', () => {
    const ws = then(group(), tile('bottom'));
    expect(ws.layout.kind === 'split' && ws.layout.direction).toBe('column');
  });

  it('expands the group everywhere', () => {
    const ws = then(
      group(),
      { type: 'set-collapsed', keys: [KEY], collapsed: true },
      tile()
    );
    expect(ws.collapsed[KEY]).toBe(false);
  });

  it('keeps a pinned home pinned, where it is', () => {
    const ws = then(
      group(),
      { type: 'set-pinned', ids: [id('home')], pinned: true },
      tile()
    );
    expect(ws.pinned).toEqual([id('home')]);
    expect(shape(ws)[0]!.order).toContain('home');
  });

  it('does nothing without its home in the pane, or with no player there', () => {
    const ws = group();
    expect(then(ws, { ...tile(), home: id('gone') } as TabsAction)).toBe(ws);
    expect(then(ws, { ...tile(), players: [id('home')] } as TabsAction)).toBe(
      ws
    );
  });
});

const follow = (
  over: Partial<Extract<TabsAction, { type: 'follow-group' }>> = {}
): TabsAction => ({
  type: 'follow-group',
  pane: 'pane-1',
  key: KEY,
  ids: [id('p1'), id('p3')],
  edge: 'right',
  show: id('p3'),
  ...over,
});

describe('following a group', () => {
  it('moves the tabs it follows to a new pane, without taking focus', () => {
    const ws = then(group(), follow());
    expect(shape(ws)).toEqual([
      { id: 'pane-1', order: ['home', 'other', 'p2'], active: 'p2' },
      { id: 'pane-2', order: ['p1', 'p3'], active: 'p3' },
    ]);
    expect(ws.focusedPane).toBe('pane-1');
    expect(ws.follows).toEqual({ 'pane-2': KEY });
  });

  it('follows in place: an unfocused pane every tab of which it follows', () => {
    const ws = then(
      group(),
      {
        type: 'split',
        ids: [id('p1'), id('p3')],
        target: 'pane-1',
        edge: 'right',
      },
      { type: 'focus-pane', pane: 'pane-1' },
      follow({ pane: 'pane-2', edge: null, show: id('p1') })
    );
    expect(shape(ws)[1]).toEqual({
      id: 'pane-2',
      order: ['p1', 'p3'],
      active: 'p1',
    });
    expect(ws.follows).toEqual({ 'pane-2': KEY });
    expect(ws.focusedPane).toBe('pane-1');
  });

  it('expands the group, so the tabs it follows show', () => {
    const ws = then(
      group(),
      { type: 'set-collapsed', keys: [KEY], collapsed: true },
      follow()
    );
    expect(ws.collapsed[KEY]).toBe(false);
  });

  it('refuses in place where the pane holds a tab it does not follow', () => {
    const ws = group();
    expect(then(ws, follow({ edge: null }))).toBe(ws);
  });

  it('follows a group in one pane at most', () => {
    const ws = then(group(), follow());
    expect(then(ws, follow({ ids: [id('p2')], show: id('p2') }))).toBe(ws);
  });

  it('switches what it shows without moving focus or order', () => {
    const ws = then(group(), follow(), {
      type: 'follow-show',
      pane: 'pane-2',
      id: id('p1'),
    });
    expect(shape(ws)[1]!.active).toBe('p1');
    expect(shape(ws)[1]!.order).toEqual(['p1', 'p3']);
    expect(ws.focusedPane).toBe('pane-1');
  });

  it('switches only a pane that follows, and only to a tab it holds', () => {
    const ws = then(group(), follow());
    const show = (pane: string, tab: string): TabsAction => ({
      type: 'follow-show',
      pane,
      id: tab,
    });
    expect(then(ws, show('pane-1', id('home')))).toBe(ws);
    expect(then(ws, show('pane-2', id('home')))).toBe(ws);
  });

  it('stops, leaving the tabs, what it shows and the layout', () => {
    const ws = then(group(), follow());
    const stopped = then(ws, { type: 'stop-following', pane: 'pane-2' });
    expect(stopped.follows).toEqual({});
    expect(stopped.layout).toBe(ws.layout);
  });

  it('ends when its pane closes, its tabs going to the neighbour', () => {
    const ws = then(group(), follow(), {
      type: 'close-pane',
      pane: 'pane-2',
    });
    expect(ws.follows).toEqual({});
    expect(panesOf(ws.layout)).toHaveLength(1);
    expect(Object.keys(ws.tabs)).toHaveLength(5);
  });

  it('ends when its last tab moves out, the pane going with it', () => {
    const ws = then(group(), follow(), {
      type: 'move-to-pane',
      ids: [id('p1'), id('p3')],
      pane: 'pane-1',
    });
    expect(ws.follows).toEqual({});
  });

  it('is not saved: following ends with the run', () => {
    const ws = then(group(), follow());
    expect(toSaved(ws)).not.toHaveProperty('follows');
  });
});

describe('where a new tab of a supervised group opens', () => {
  const live: ItemEntry = {
    itemKey: 'branch:p4',
    branch: 'p4',
    sessionName: 's4',
    running: true,
  };
  const inGroup = (tab: { kind: string; itemKey?: string }) =>
    tab.kind === 'item' && /branch:(home|p\d)$/.test(tab.itemKey ?? '')
      ? KEY
      : 'place';
  const sync: TabsAction = {
    type: 'sync-items',
    repo: REPO,
    entries: [live],
    groupOf: inGroup,
    isHome: (tab) => tab.kind === 'item' && tab.itemKey === 'branch:home',
  };

  it('beside its players, not its home, when the group is tiled', () => {
    const ws = then(group(), tile(), sync);
    expect(shape(ws)[1]!.order).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(ws.focusedPane).toBe('pane-1');
  });

  it('in the pane following its group', () => {
    const ws = then(group(), follow(), sync);
    expect(shape(ws)[1]!.order).toEqual(['p1', 'p3', 'p4']);
    expect(shape(ws)[1]!.active).toBe('p3');
  });
});

describe('room for a supervising layout', () => {
  it('tiles right where both halves keep their width, else down', () => {
    expect(tileEdge({ width: 484, height: 180 })).toBe('right');
    expect(tileEdge({ width: 483, height: 364 })).toBe('bottom');
    expect(tileEdge({ width: 483, height: 363 })).toBeNull();
  });

  it('counts the follow line in the new pane’s height', () => {
    expect(followEdge({ width: 484, height: 208 }, 0)).toBe('right');
    expect(followEdge({ width: 484, height: 207 }, 0)).toBeNull();
    expect(followEdge({ width: 300, height: 392 }, 0)).toBe('bottom');
    expect(followEdge({ width: 300, height: 391 }, 0)).toBeNull();
  });

  it('and a source that already follows, its own', () => {
    expect(followEdge({ width: 300, height: 420 }, 28)).toBe('bottom');
    expect(followEdge({ width: 300, height: 419 }, 28)).toBeNull();
  });
});
