import { describe, expect, it } from 'vitest';
import type { SavedWorkspace } from '../../../host/contract.js';
import { itemTabId } from './tab-identity.js';
import { splitKey, type Edge } from './layout.js';
import { closeNeighbour, paneRects, paneToward } from './layout-geometry.js';
import {
  EMPTY_WORKSPACE,
  reduce,
  type ItemEntry,
  type TabsAction,
  type Workspace,
} from './tabs-model.js';
import { rebuildsLayout } from './pane-moves.js';
import { restoreWorkspace, toSaved } from './workspace-file.js';
import { panesOf, type LayoutNode, type PaneNode } from './workspace.js';

const REPO = '/repos/alpha';
const id = (key: string) => itemTabId(REPO, key);
const open = (key: string): TabsAction => ({
  type: 'open-item',
  repo: REPO,
  itemKey: key,
  preview: false,
});
const run = (...actions: TabsAction[]) =>
  actions.reduce(reduce, EMPTY_WORKSPACE);
const then = (ws: Workspace, ...actions: TabsAction[]) =>
  actions.reduce(reduce, ws);
const split = (
  ids: string[],
  target: string,
  edge: Edge,
  activate?: string
): TabsAction => ({ type: 'split', ids, target, edge, activate });

/** Each pane's tabs (by item key) and the one it shows. */
const shape = (ws: Workspace) =>
  panesOf(ws.layout).map((p) => ({
    id: p.id,
    order: p.order.map((t) => t.slice(t.lastIndexOf(':') - 6)),
    active: p.activeId?.slice(p.activeId.lastIndexOf(':') - 6) ?? null,
  }));

const threeTabs = () =>
  run(open('branch:a'), open('branch:b'), open('branch:c'));

describe('splitting', () => {
  it('moves the tab into a new pane on that side, shown and focused', () => {
    const ws = then(threeTabs(), split([id('branch:b')], 'pane-1', 'right'));
    expect(ws.layout.kind).toBe('split');
    expect(ws.layout.kind === 'split' && ws.layout.direction).toBe('row');
    expect(ws.layout.kind === 'split' && ws.layout.sizes).toEqual([0.5, 0.5]);
    expect(shape(ws)).toEqual([
      { id: 'pane-1', order: ['branch:a', 'branch:c'], active: 'branch:c' },
      { id: 'pane-2', order: ['branch:b'], active: 'branch:b' },
    ]);
    expect(ws.focusedPane).toBe('pane-2');
    expect(Object.keys(ws.tabs)).toHaveLength(3);
  });

  it('puts the new pane first for a left or top split', () => {
    const ws = then(threeTabs(), split([id('branch:a')], 'pane-1', 'top'));
    expect(ws.layout.kind === 'split' && ws.layout.direction).toBe('column');
    expect(panesOf(ws.layout).map((p) => p.id)).toEqual(['pane-2', 'pane-1']);
  });

  it('does nothing when every tab of the pane would leave it', () => {
    const one = run(open('branch:a'));
    expect(then(one, split([id('branch:a')], 'pane-1', 'right'))).toBe(one);
  });

  it('joins a split running the same way rather than nesting one', () => {
    const ws = then(
      threeTabs(),
      split([id('branch:c')], 'pane-1', 'right'),
      split([id('branch:b')], 'pane-1', 'right')
    );
    expect(ws.layout.kind === 'split' && ws.layout.children).toHaveLength(3);
    expect(ws.layout.kind === 'split' && ws.layout.sizes).toEqual([
      0.25, 0.25, 0.5,
    ]);
  });

  it('shows the active tab a group carries, else the one asked for', () => {
    const carried = then(
      threeTabs(),
      split([id('branch:b'), id('branch:c')], 'pane-1', 'right', id('branch:b'))
    );
    expect(shape(carried)[1]!.active).toBe('branch:c');
  });

  it('shows the tab asked for when a group moves', () => {
    const ws = then(
      threeTabs(),
      split(
        [id('branch:a'), id('branch:b')],
        'pane-1',
        'bottom',
        id('branch:b')
      )
    );
    expect(shape(ws)[1]).toEqual({
      id: 'pane-2',
      order: ['branch:a', 'branch:b'],
      active: 'branch:b',
    });
  });

  // A property-test counterexample: focus that moves with a split moves
  // where its repository was left, so coming back lands there.
  it('notes the tab a split shows as where its repository was left', () => {
    const ws = then(
      threeTabs(),
      { type: 'activate', id: id('branch:a') },
      split([id('branch:b')], 'pane-1', 'right')
    );
    expect(ws.lastActiveByRepo[REPO]).toBe(id('branch:b'));
  });

  it('keeps a moved tab pinned', () => {
    const ws = then(
      threeTabs(),
      { type: 'set-pinned', ids: [id('branch:b')], pinned: true },
      split([id('branch:b')], 'pane-1', 'right')
    );
    expect(ws.pinned).toEqual([id('branch:b')]);
  });
});

describe('a drop that changes nothing', () => {
  it('knows a pane’s every tab dropped on its neighbour’s facing side rebuilds the same layout', () => {
    // row[pane-1 (a, c), pane-2 (b)]
    const ws = then(threeTabs(), split([id('branch:b')], 'pane-1', 'right'));
    // pane-2's only tab onto pane-1's right side: back where it was.
    expect(rebuildsLayout(ws, [id('branch:b')], 'pane-1', 'right')).toBe(true);
    // Onto its left side: the panes trade places.
    expect(rebuildsLayout(ws, [id('branch:b')], 'pane-1', 'left')).toBe(false);
    // One tab of two: a third pane.
    expect(rebuildsLayout(ws, [id('branch:a')], 'pane-2', 'left')).toBe(false);
  });
});

describe('moving between panes', () => {
  const twoPanes = () =>
    then(threeTabs(), split([id('branch:c')], 'pane-1', 'right'));

  it('removes the source pane its last tab left, and the split with it', () => {
    const ws = then(twoPanes(), {
      type: 'move-to-pane',
      ids: [id('branch:c')],
      pane: 'pane-1',
    });
    expect(ws.layout.kind).toBe('pane');
    expect(shape(ws)).toEqual([
      {
        id: 'pane-1',
        order: ['branch:a', 'branch:b', 'branch:c'],
        active: 'branch:c',
      },
    ]);
    expect(ws.focusedPane).toBe('pane-1');
  });

  it('lands beside the anchor', () => {
    const ws = then(twoPanes(), {
      type: 'move-to-pane',
      ids: [id('branch:c')],
      pane: 'pane-1',
      anchor: { targetId: id('branch:a'), side: 'after' },
    });
    expect(shape(ws)[0]!.order).toEqual(['branch:a', 'branch:c', 'branch:b']);
  });

  it('moves a strip drop onto another pane’s tab into that pane', () => {
    const ws = then(twoPanes(), {
      type: 'move',
      ids: [id('branch:a')],
      targetId: id('branch:c'),
      side: 'before',
    });
    expect(shape(ws)[1]!.order).toEqual(['branch:a', 'branch:c']);
  });

  // A property-test counterexample: a drag naming a tab no longer open
  // beside one that is, within one pane, is a reorder, not a move.
  it('reorders within the pane when the move names a closed tab too', () => {
    const ws = then(threeTabs(), { type: 'activate', id: id('branch:b') });
    const after = then(ws, {
      type: 'move',
      ids: [id('branch:a'), 'terminal:gone'],
      targetId: id('branch:c'),
      side: 'after',
    });
    expect(shape(after)[0]).toEqual({
      id: 'pane-1',
      order: ['branch:b', 'branch:c', 'branch:a'],
      active: 'branch:b',
    });
  });

  it('activates a tab in another pane by focusing that pane', () => {
    const ws = then(twoPanes(), { type: 'activate', id: id('branch:a') });
    expect(ws.focusedPane).toBe('pane-1');
    expect(shape(ws)[0]!.active).toBe('branch:a');
  });

  it('opens a tab already open in another pane there, not twice', () => {
    const ws = then(
      twoPanes(),
      { type: 'focus-pane', pane: 'pane-1' },
      open('branch:c')
    );
    expect(Object.keys(ws.tabs)).toHaveLength(3);
    expect(ws.focusedPane).toBe('pane-2');
  });

  it('opening a repository focuses the pane holding its tab, rather than blanking this one', () => {
    const OTHER = '/repos/beta';
    const ws = then(
      run(open('branch:a'), {
        type: 'open-item',
        repo: OTHER,
        itemKey: 'branch:b',
        preview: false,
      }),
      split([id('branch:a')], 'pane-1', 'right'),
      { type: 'focus-pane', pane: 'pane-1' },
      { type: 'repo-opened', repo: REPO }
    );
    expect(ws.focusedPane).toBe('pane-2');
    expect(shape(ws).map((p) => p.active)).toEqual(['branch:b', 'branch:a']);
  });

  it('opens a new tab in the focused pane', () => {
    const ws = then(twoPanes(), open('branch:d'));
    expect(shape(ws)[1]!.order).toEqual(['branch:c', 'branch:d']);
  });
});

describe('closing a pane', () => {
  it('moves its tabs, order and active tab to its neighbour and closes nothing', () => {
    const ws = then(
      threeTabs(),
      { type: 'activate', id: id('branch:b') },
      split(
        [id('branch:b'), id('branch:c')],
        'pane-1',
        'right',
        id('branch:b')
      ),
      { type: 'close-pane', pane: 'pane-2' }
    );
    expect(shape(ws)).toEqual([
      {
        id: 'pane-1',
        order: ['branch:a', 'branch:b', 'branch:c'],
        active: 'branch:b',
      },
    ]);
    expect(ws.focusedPane).toBe('pane-1');
    expect(Object.keys(ws.tabs)).toHaveLength(3);
  });

  it('leaves the sole pane', () => {
    const ws = threeTabs();
    expect(then(ws, { type: 'close-pane', pane: 'pane-1' })).toBe(ws);
  });

  it('closing a pane’s last tab removes the pane', () => {
    const ws = then(threeTabs(), split([id('branch:c')], 'pane-1', 'right'), {
      type: 'close',
      id: id('branch:c'),
    });
    expect(ws.layout.kind).toBe('pane');
    expect(ws.focusedPane).toBe('pane-1');
  });
});

describe('focus and move toward a side', () => {
  const grid = () =>
    then(
      run(
        open('branch:a'),
        open('branch:b'),
        open('branch:c'),
        open('branch:d')
      ),
      split([id('branch:b')], 'pane-1', 'right'),
      split([id('branch:c')], 'pane-1', 'bottom'),
      { type: 'focus-pane', pane: 'pane-3' }
    );

  it('focuses the pane that way, keeping what each shows', () => {
    const ws = then(grid(), { type: 'focus-toward', edge: 'right' });
    expect(ws.focusedPane).toBe('pane-2');
    expect(then(ws, { type: 'focus-toward', edge: 'right' })).toBe(ws);
  });

  it('moves the active tab that way and follows it', () => {
    const ws = then(grid(), { type: 'move-toward', edge: 'top' });
    expect(ws.focusedPane).toBe('pane-1');
    expect(panesOf(ws.layout)).toHaveLength(2);
    expect(shape(ws)[0]!.active).toBe('branch:c');
  });
});

describe('reconciling across panes', () => {
  it('opens a newly running agent in the pane holding its group', () => {
    const live: ItemEntry = {
      itemKey: 'branch:e',
      branch: 'e',
      sessionName: 'se',
      running: true,
    };
    const ws = then(
      threeTabs(),
      split([id('branch:c')], 'pane-1', 'right'),
      { type: 'focus-pane', pane: 'pane-1' },
      {
        type: 'sync-items',
        repo: REPO,
        entries: [live],
        groupOf: (tab) =>
          tab.kind === 'item' && ['branch:c', 'branch:e'].includes(tab.itemKey)
            ? 'claude:boss'
            : 'place',
      }
    );
    expect(shape(ws)[1]!.order).toEqual(['branch:c', 'branch:e']);
    // Background: nothing moves, and it is news.
    expect(ws.focusedPane).toBe('pane-1');
    expect(shape(ws)[1]!.active).toBe('branch:c');
    expect(ws.unseen).toEqual([id('branch:e')]);
  });

  it('closes a removed worktree’s tab in whichever pane holds it', () => {
    const ws = then(
      threeTabs(),
      split([id('branch:c')], 'pane-1', 'right'),
      {
        type: 'sync-items',
        repo: REPO,
        entries: [{ itemKey: 'branch:c', branch: 'c', worktree: '/wt/c' }],
      },
      { type: 'worktrees-removed', repo: REPO, worktrees: ['/wt/c'] }
    );
    expect(ws.layout.kind).toBe('pane');
    expect(Object.keys(ws.tabs)).toHaveLength(2);
  });

  it('never hands the focused pane another repository’s tab on a background close', () => {
    const OTHER = '/repos/beta';
    const ws = then(
      run(open('branch:a1'), open('branch:a2'), {
        type: 'open-item',
        repo: OTHER,
        itemKey: 'branch:b1',
        preview: false,
      }),
      split([id('branch:a2')], 'pane-1', 'right'),
      { type: 'activate', id: id('branch:a1') },
      {
        type: 'sync-items',
        repo: REPO,
        entries: [
          { itemKey: 'branch:a1', branch: 'a1', worktree: '/wt/a1' },
          { itemKey: 'branch:a2', branch: 'a2' },
        ],
      },
      { type: 'worktrees-removed', repo: REPO, worktrees: ['/wt/a1'] }
    );
    // pane-1 keeps beta's tab, unshown: showing it would switch the
    // window to beta because a worktree went away.
    expect(ws.focusedPane).toBe('pane-1');
    const [left, right] = panesOf(ws.layout);
    expect(left!.order).toEqual([itemTabId(OTHER, 'branch:b1')]);
    expect(left!.activeId).toBeNull();
    expect(right!.activeId).toBe(id('branch:a2'));
  });
});

// A property-test counterexample: a listing closing a pinned tab takes
// its pin with it.
it('drops the pin of a tab a listing closed', () => {
  const shell = {
    name: 'n10-shell',
    kind: 'shell' as const,
    cwd: REPO,
    displayPath: REPO,
    repo: REPO,
  };
  const ws = run(
    { type: 'sync-items', repo: REPO, terminals: [shell] },
    { type: 'set-pinned', ids: ['terminal:n10-shell'], pinned: true },
    { type: 'sync-items', repo: REPO, terminals: [] }
  );
  expect(ws.tabs).toEqual({});
  expect(ws.pinned).toEqual([]);
});

describe('resizing', () => {
  it('stores a split’s sizes by its key', () => {
    const ws = then(threeTabs(), split([id('branch:c')], 'pane-1', 'right'));
    const key = splitKey(ws.layout as Extract<LayoutNode, { kind: 'split' }>);
    expect(key).toBe('pane-1|pane-2');
    const resized = then(ws, { type: 'resize-split', key, sizes: [70, 30] });
    expect(resized.layout.kind === 'split' && resized.layout.sizes).toEqual([
      0.7, 0.3,
    ]);
    expect(then(resized, { type: 'resize-split', key, sizes: [7, 3] })).toBe(
      resized
    );
  });

  it('restores a split with its sizes, panes and focus', () => {
    const ws = then(
      threeTabs(),
      split([id('branch:c')], 'pane-1', 'bottom'),
      { type: 'resize-split', key: 'pane-1|pane-2', sizes: [0.3, 0.7] },
      { type: 'focus-pane', pane: 'pane-1' }
    );
    const file = JSON.parse(JSON.stringify(toSaved(ws))) as SavedWorkspace;
    const back = restoreWorkspace(file);
    expect(back.layout).toEqual(ws.layout);
    expect(back.focusedPane).toBe('pane-1');
  });

  it('restores a hand-edited layout into a well-formed one', () => {
    const ws = threeTabs();
    const saved = JSON.parse(JSON.stringify(toSaved(ws))) as SavedWorkspace;
    const pane = (paneId: string, order: string[]): PaneNode => ({
      kind: 'pane',
      id: paneId,
      order,
      activeId: order[0] ?? null,
    });
    const layout = {
      kind: 'split',
      direction: 'row',
      sizes: [1, 'x', 3],
      children: [
        pane('pane-1', [id('branch:a'), id('branch:b')]),
        // Claimed already: dropped, and the pane goes with it.
        pane('pane-2', [id('branch:a')]),
        pane('pane-3', [id('branch:c')]),
      ],
    };
    const back = restoreWorkspace({ ...saved, layout });
    expect(back.layout).toEqual({
      kind: 'split',
      // Saved without an id: it is given one.
      id: 'split-1',
      direction: 'row',
      sizes: [0.25, 0.75],
      children: [
        pane('pane-1', [id('branch:a'), id('branch:b')]),
        pane('pane-3', [id('branch:c')]),
      ],
    });
  });
});

describe('names', () => {
  it('keeps a split’s id while its first pane goes, and names a new one afresh', () => {
    const four = then(
      run(
        open('branch:a'),
        open('branch:b'),
        open('branch:c'),
        open('branch:d')
      ),
      split([id('branch:b')], 'pane-1', 'right'),
      split([id('branch:c')], 'pane-2', 'bottom'),
      split([id('branch:d')], 'pane-3', 'bottom')
    );
    const column = (ws: Workspace) =>
      ws.layout.kind === 'split' ? ws.layout.children[1]! : null;
    expect(four.layout.kind === 'split' && four.layout.id).toBe('split-1');
    expect(column(four)).toMatchObject({ kind: 'split', id: 'split-2' });
    expect(panesOf(column(four)!).map((p) => p.id)).toEqual([
      'pane-2',
      'pane-3',
      'pane-4',
    ]);
    const less = then(four, { type: 'close-pane', pane: 'pane-2' });
    expect(column(less)).toMatchObject({ kind: 'split', id: 'split-2' });
  });

  it('renames a restored pane whose id is taken or malformed, keeping its tabs', () => {
    const saved = JSON.parse(
      JSON.stringify(toSaved(threeTabs()))
    ) as SavedWorkspace;
    const pane = (paneId: string, order: string[]): PaneNode => ({
      kind: 'pane',
      id: paneId,
      order,
      activeId: order[0]!,
    });
    const layout = {
      kind: 'split',
      id: 'split-4',
      direction: 'column',
      sizes: [1, 1, 1],
      children: [
        pane('pane-1', [id('branch:a')]),
        pane('pane-1', [id('branch:b')]),
        pane('left:pane', [id('branch:c')]),
      ],
    };
    const back = restoreWorkspace({ ...saved, layout });
    expect(panesOf(back.layout).map((p) => [p.id, p.order.length])).toEqual([
      ['pane-1', 1],
      ['pane-2', 1],
      ['pane-3', 1],
    ]);
    expect(back.layout.kind === 'split' && back.layout.id).toBe('split-4');
  });
});

describe('pane geometry', () => {
  // ┌───┬───┐
  // │ 1 │ 2 │
  // ├───┤   │
  // │ 3 │   │
  // └───┴───┘
  const pane = (paneId: string): PaneNode => ({
    kind: 'pane',
    id: paneId,
    order: [paneId],
    activeId: paneId,
  });
  const layout: LayoutNode = {
    kind: 'split',
    direction: 'row',
    sizes: [0.5, 0.5],
    children: [
      {
        kind: 'split',
        direction: 'column',
        sizes: [0.5, 0.5],
        children: [pane('1'), pane('3')],
      },
      pane('2'),
    ],
  };

  it('lays panes out by their sizes', () => {
    expect(paneRects(layout).get('3')).toEqual({
      x: 0,
      y: 0.5,
      w: 0.5,
      h: 0.5,
    });
  });

  it('finds the pane level with a side, and nothing past the edge', () => {
    expect(paneToward(layout, '3', 'right')).toBe('2');
    expect(paneToward(layout, '2', 'left')).toBe('1');
    expect(paneToward(layout, '1', 'bottom')).toBe('3');
    expect(paneToward(layout, '1', 'left')).toBeNull();
  });

  it('breaks a tie between neighbours level with its sides left, right, up, down', () => {
    // Level on both sides it touches: left, right, up, down breaks the tie.
    expect(closeNeighbour(layout, '1')).toBe('2');
    expect(closeNeighbour(layout, '2')).toBe('1');
  });

  it('gives a closed pane’s tabs to the neighbour centred nearest its side, not the one sharing most of it', () => {
    // ┌───┬───┐  4 meets 5, 6 and 7 along its right side: 5 and 7 share
    // │   │ 5 │  more of it and come first, but 6 sits level with its
    // │ 4 ├───┤  middle.
    // │   │ 6 │
    // │   ├───┤
    // │   │ 7 │
    // └───┴───┘
    const beside: LayoutNode = {
      kind: 'split',
      direction: 'row',
      sizes: [0.5, 0.5],
      children: [
        pane('4'),
        {
          kind: 'split',
          direction: 'column',
          sizes: [0.4, 0.2, 0.4],
          children: [pane('5'), pane('6'), pane('7')],
        },
      ],
    };
    expect(closeNeighbour(beside, '4')).toBe('6');
  });
});
