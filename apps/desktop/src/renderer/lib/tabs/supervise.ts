import { panesOf, replacePane, type Edge } from './layout.js';
import { canSplit, MIN_PANE } from './layout-geometry.js';
import { splitPane } from './pane-moves.js';
import { chooseCollapsed } from './tab-order.js';
import type { PaneId, PaneNode, Workspace } from './workspace.js';

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

interface Frame { width: number; height: number }

/** Where Tile group splits a pane of `frame`'s size: right where both
 *  halves keep their minimum (`canSplit`), else down, else nowhere. */
export function tileEdge(frame: Frame): 'right' | 'bottom' | null {
  if (canSplit(frame, 'right')) return 'right';
  return canSplit(frame, 'bottom') ? 'bottom' : null;
}

/** Where Follow group splits a pane of `frame`'s size, as `tileEdge`,
 *  with the new pane's follow line, and the source's own (`sourceLine`)
 *  when it already follows, taken out of the height first. */
export function followEdge(
  frame: Frame,
  sourceLine: number
): 'right' | 'bottom' | null {
  const lines = { width: frame.width, height: frame.height - sourceLine };
  if (canSplit(frame, 'right') && frame.height >= MIN_PANE.height + FOLLOW_LINE_PX)
    return 'right';
  const room = { ...lines, height: lines.height - FOLLOW_LINE_PX };
  return canSplit(room, 'bottom') ? 'bottom' : null;
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
  return Object.entries(ws.follows).find(([, k]) => k === key)?.[0];
}

/**
 * Follow group `key` from pane `pane`: `ids` go to a new pane on its
 * `edge`, or, with no edge, `pane` itself follows (every tab it holds
 * is the group's). The follow pane shows `show`. Focus stays where it
 * is, and so does whatever the focused pane shows. One pane follows a
 * group at most; a second request is refused.
 */
export function followGroup(
  ws: Workspace,
  follow: {
    pane: PaneId;
    key: string;
    ids: readonly string[];
    edge: Edge | null;
    show: string;
  }
): Workspace {
  if (followerOf(ws, follow.key) !== undefined) return ws;
  const source = paneById(ws, follow.pane);
  if (!source || !follow.ids.includes(follow.show)) return ws;
  if (follow.edge === null) {
    if (ws.follows[follow.pane] !== undefined) return ws;
    if (!source.order.every((id) => follow.ids.includes(id))) return ws;
    return registered(ws, follow.pane, follow.key, follow.show);
  }
  const split = splitPane(ws, follow.ids, follow.pane, follow.edge);
  if (split === ws) return ws;
  const added = panesOf(split.layout).find((p) =>
    p.order.includes(follow.show)
  )!;
  return registered(
    { ...split, focusedPane: ws.focusedPane },
    added.id,
    follow.key,
    follow.show
  );
}

function registered(
  ws: Workspace,
  pane: PaneId,
  key: string,
  show: string
): Workspace {
  const node = paneById(ws, pane)!;
  return {
    ...ws,
    layout: replacePane(ws.layout, pane, { ...node, activeId: show }),
    follows: { ...ws.follows, [pane]: key },
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
 * A follow pane switches to tab `id`, one it holds: the active tab
 * changes and nothing else does — not focus, not the order.
 */
export function followShow(ws: Workspace, pane: PaneId, id: string): Workspace {
  const node = paneById(ws, pane);
  if (ws.follows[pane] === undefined || !node?.order.includes(id)) return ws;
  if (node.activeId === id) return ws;
  return {
    ...ws,
    layout: replacePane(ws.layout, pane, { ...node, activeId: id }),
  };
}

/** Registrations of panes that are gone go with them: a closed follow
 *  pane follows nothing, and its id may be given to a new pane. */
export function dropGoneFollows(ws: Workspace): Workspace {
  const panes = Object.keys(ws.follows);
  if (panes.length === 0) return ws;
  const live = new Set(panesOf(ws.layout).map((p) => p.id));
  if (panes.every((p) => live.has(p))) return ws;
  return {
    ...ws,
    follows: Object.fromEntries(
      Object.entries(ws.follows).filter(([p]) => live.has(p))
    ),
  };
}
