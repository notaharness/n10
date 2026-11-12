import { panesOf, replacePane, type Edge } from './layout.js';
import { canSplit, MIN_PANE } from './layout-geometry.js';
import { splitPane } from './pane-moves.js';
import { chooseCollapsed } from './tab-order.js';
import type { Tab } from './tab-identity.js';
import type { Following, PaneId, PaneNode, Workspace } from './workspace.js';

/**
 * The supervising layouts, as layout actions: tiling a group (its
 * orchestrator's home in one pane, its players in another) and following
 * one (a pane that shows whichever member last had new output, without
 * taking focus). Like every layout action, none opens, closes or stops a
 * tab, and a tab is only ever in one pane: a follow pane owns the tabs
 * it shows, it never mirrors another pane's.
 *
 * Which tabs move is the strip's to say (`supervise-plan.ts`): only it
 * knows a tab's group. These take the ids it chose.
 */

/** The height of a follow pane's line under its strip, which its
 *  minimum height includes. */
export const FOLLOW_LINE_PX = 28;

/** How much taller than the pane minimum pane `pane` must be. */
export function extraHeightOf(ws: Workspace): (pane: PaneId) => number {
  return (pane) => (ws.follows[pane] === undefined ? 0 : FOLLOW_LINE_PX);
}

interface Frame {
  width: number;
  height: number;
}

/** Where Tile group splits a pane of `frame`'s size: right where both
 *  halves keep their minimum (`canSplit`), else down, else nowhere. */
export function tileEdge(frame: Frame): 'right' | 'bottom' | null {
  if (canSplit(frame, 'right')) return 'right';
  return canSplit(frame, 'bottom') ? 'bottom' : null;
}

/** Where Follow group splits a pane with `room` to split (its frame
 *  less its own follow line, `splitRoom`), as `tileEdge`, with the new
 *  pane's follow line taken out of its height. */
export function followEdge(room: Frame): 'right' | 'bottom' | null {
  if (
    canSplit(room, 'right') &&
    room.height >= MIN_PANE.height + FOLLOW_LINE_PX
  )
    return 'right';
  const below = { width: room.width, height: room.height - FOLLOW_LINE_PX };
  return canSplit(below, 'bottom') ? 'bottom' : null;
}

function paneById(ws: Workspace, id: PaneId): PaneNode | undefined {
  return panesOf(ws.layout).find((p) => p.id === id);
}

/**
 * Tile a group: `players` leave pane `pane` for a new pane on its
 * `edge`, in their order, and the home stays. The new pane shows the
 * player the source showed when one moved, else the first; the source
 * shows the home and keeps focus. The group expands everywhere, so the
 * players are in sight.
 */
export function tileGroup(
  ws: Workspace,
  tile: {
    pane: PaneId;
    key: string;
    home: string;
    players: readonly string[];
    edge: Edge;
  }
): Workspace {
  const source = paneById(ws, tile.pane);
  if (!source?.order.includes(tile.home)) return ws;
  const moving = tile.players.filter(
    (id) => id !== tile.home && source.order.includes(id)
  );
  if (moving.length === 0) return ws;
  const split = splitPane(ws, moving, tile.pane, tile.edge);
  if (split === ws) return ws;
  const left = paneById(split, tile.pane)!;
  return {
    ...split,
    layout: replacePane(split.layout, tile.pane, {
      ...left,
      activeId: tile.home,
    }),
    focusedPane: tile.pane,
    collapsed: chooseCollapsed(split.collapsed, [tile.key], false),
  };
}

/** The pane following group `key`, if one is. */
export function followerOf(ws: Workspace, key: string): PaneId | undefined {
  return Object.entries(ws.follows).find(([, f]) => f.key === key)?.[0];
}

/**
 * Follow group `key` from pane `pane`: those of `ids` the pane holds go
 * to a new pane on its `edge`, which follows them and shows `show`, its
 * group expanded so every tab it follows is in sight. Focus stays where
 * it is, and so does whatever the focused pane shows. One pane follows a
 * group at most; a second request is refused.
 */
export function followGroup(
  ws: Workspace,
  follow: {
    pane: PaneId;
    key: string;
    ids: readonly string[];
    edge: Edge;
    show: string;
  }
): Workspace {
  if (followerOf(ws, follow.key) !== undefined) return ws;
  const source = paneById(ws, follow.pane);
  // Only the source's own: the plan was made a menu ago.
  const ids = follow.ids.filter((id) => source?.order.includes(id));
  if (!ids.includes(follow.show)) return ws;
  const split = splitPane(ws, ids, follow.pane, follow.edge);
  if (split === ws) return ws;
  const added = panesOf(split.layout).find((p) =>
    p.order.includes(follow.show)
  )!;
  return {
    ...split,
    focusedPane: ws.focusedPane,
    layout: replacePane(split.layout, added.id, {
      ...added,
      activeId: follow.show,
    }),
    follows: { ...split.follows, [added.id]: { key: follow.key, ids } },
    collapsed: chooseCollapsed(split.collapsed, [follow.key], false),
  };
}

/** Pane `pane` stops following; its tabs and what it shows stay. */
export function stopFollowing(ws: Workspace, pane: PaneId): Workspace {
  if (ws.follows[pane] === undefined) return ws;
  const follows = Object.fromEntries(
    Object.entries(ws.follows).filter(([p]) => p !== pane)
  );
  return { ...ws, follows };
}

/**
 * A follow pane switches to tab `id`, one it follows: the active tab
 * changes and nothing else does — not focus, not the order.
 */
export function followShow(ws: Workspace, pane: PaneId, id: string): Workspace {
  const node = paneById(ws, pane);
  if (!ws.follows[pane]?.ids.includes(id) || !node?.order.includes(id))
    return ws;
  if (node.activeId === id) return ws;
  return {
    ...ws,
    layout: replacePane(ws.layout, pane, { ...node, activeId: id }),
  };
}

/**
 * What each follow pane follows once an action has run: the tabs it
 * still holds unpinned. A pane that is gone, the only pane left (it
 * would be paused for good: it always has focus), or that holds none
 * of its tabs any more follows nothing. The same workspace when nothing
 * changes.
 */
export function settleFollows(ws: Workspace): Workspace {
  const entries = Object.entries(ws.follows);
  if (entries.length === 0) return ws;
  const panes = panesOf(ws.layout);
  const pinned = new Set(ws.pinned);
  let changed = false;
  const kept: [PaneId, Following][] = [];
  for (const [id, f] of entries) {
    const pane = panes.length > 1 ? panes.find((p) => p.id === id) : undefined;
    const ids = f.ids.filter((t) => pane?.order.includes(t) && !pinned.has(t));
    if (ids.length !== f.ids.length) changed = true;
    if (ids.length > 0)
      kept.push([id, ids.length === f.ids.length ? f : { ...f, ids }]);
  }
  return changed ? { ...ws, follows: Object.fromEntries(kept) } : ws;
}

/**
 * Tabs a sync opened in a follow pane, of the group it follows and not
 * its home, join what it follows (`placeFor` sends them there).
 */
export function adoptOpened(
  before: Workspace,
  after: Workspace,
  grouping: { groupOf(tab: Tab): string | null; isHome?(tab: Tab): boolean }
): Workspace {
  const entries = Object.entries(after.follows);
  if (entries.length === 0) return after;
  const opened = Object.values(after.tabs).filter(
    (t) => !Object.hasOwn(before.tabs, t.id) && !grouping.isHome?.(t)
  );
  if (opened.length === 0) return after;
  let changed = false;
  const follows = Object.fromEntries(
    entries.map(([id, f]) => {
      const order = paneById(after, id)?.order ?? [];
      const joining = opened
        .filter((t) => order.includes(t.id) && grouping.groupOf(t) === f.key)
        .map((t) => t.id)
        .filter((t) => !f.ids.includes(t));
      if (joining.length === 0) return [id, f];
      changed = true;
      return [id, { ...f, ids: [...f.ids, ...joining] }];
    })
  );
  return changed ? { ...after, follows } : after;
}
