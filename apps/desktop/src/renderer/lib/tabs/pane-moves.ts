import {
  insertBeside,
  nextPaneId,
  panesOf,
  prunePanes,
  removePane,
  replacePane,
  type Edge,
} from './layout.js';
import { closeNeighbour, paneToward } from './layout-geometry.js';
import {
  focusedPaneOf,
  type LayoutNode,
  type PaneId,
  type PaneNode,
  type Workspace,
} from './workspace.js';

/**
 * Moving tabs between panes, and the panes themselves: splitting one,
 * closing one, and moving focus. Layout actions never open, close or
 * stop anything: a tab moved is the same tab, pin and all.
 */

/** Where moved tabs land in their new pane: beside a tab already
 *  there, else at its end. */
export interface Anchor {
  targetId: string;
  side: 'before' | 'after';
}

/** `order` without `gone`, and the tab that takes over when the active
 *  one went: the one that slid into its place, else the one before. */
function without(pane: PaneNode, gone: ReadonlySet<string>): PaneNode {
  if (!pane.order.some((id) => gone.has(id))) return pane;
  const order = pane.order.filter((id) => !gone.has(id));
  let activeId = pane.activeId;
  if (activeId !== null && gone.has(activeId)) {
    const at = pane.order.indexOf(activeId);
    const after = pane.order.slice(at + 1).find((id) => !gone.has(id));
    const before = pane.order
      .slice(0, at)
      .reverse()
      .find((id) => !gone.has(id));
    activeId = after ?? before ?? null;
  }
  return { ...pane, order, activeId };
}

function insertAt(
  order: readonly string[],
  moving: readonly string[],
  anchor: Anchor | undefined
): string[] {
  const at = anchor ? order.indexOf(anchor.targetId) : -1;
  if (!anchor || at < 0) return [...order, ...moving];
  const i = anchor.side === 'after' ? at + 1 : at;
  return [...order.slice(0, i), ...moving, ...order.slice(i)];
}

/** Take empty panes out, unless one is all there is. Focus on a pane
 *  taken out goes to its neighbour. */
export function dropEmptyPanes(ws: Workspace): Workspace {
  const panes = panesOf(ws.layout);
  if (panes.length < 2 || panes.every((p) => p.order.length > 0)) return ws;
  let focusedPane = ws.focusedPane;
  let layout = ws.layout;
  for (const pane of panes) {
    if (pane.order.length > 0) continue;
    if (panesOf(layout).length < 2) break;
    if (pane.id === focusedPane) {
      focusedPane = closeNeighbour(layout, pane.id) ?? focusedPane;
    }
    layout = removePane(layout, pane.id);
  }
  const ids = new Set(panesOf(layout).map((p) => p.id));
  if (!ids.has(focusedPane)) focusedPane = panesOf(layout)[0]!.id;
  return { ...ws, layout, focusedPane };
}

/** The tab a move's destination shows: see `moveToPane`. */
function shownAfterMove(
  panes: readonly PaneNode[],
  dest: PaneId,
  moving: readonly string[],
  activate: string | undefined
): string {
  const carried = panes.find(
    (p) => p.id !== dest && p.activeId !== null && moving.includes(p.activeId)
  )?.activeId;
  if (carried) return carried;
  if (activate !== undefined && moving.includes(activate)) return activate;
  return moving[0]!;
}

/**
 * Move `ids` (in their present order, from wherever they are) into pane
 * `dest`, beside `anchor` or at its end. The destination takes focus and
 * shows the active tab of a pane that lost it to this move, else
 * `activate`, else the first tab moved. A pane left empty goes.
 */
export function moveToPane(
  ws: Workspace,
  ids: readonly string[],
  dest: PaneId,
  anchor?: Anchor,
  activate?: string
): Workspace {
  const panes = panesOf(ws.layout);
  const target = panes.find((p) => p.id === dest);
  const asked = new Set(ids);
  // Every tab asked for, in the order the panes hold them.
  const moving = panes.flatMap((p) => p.order.filter((id) => asked.has(id)));
  if (!target || moving.length === 0 || asked.has(anchor?.targetId ?? '')) {
    return ws;
  }
  const gone = new Set(moving);
  const shown = shownAfterMove(panes, dest, moving, activate);
  let layout = ws.layout;
  for (const pane of panes) {
    if (pane.id === dest) continue;
    const next = without(pane, gone);
    if (next !== pane) layout = replacePane(layout, pane.id, next);
  }
  const rest = target.order.filter((id) => !gone.has(id));
  layout = replacePane(layout, dest, {
    ...target,
    order: insertAt(rest, moving, anchor),
    activeId: shown,
  });
  return dropEmptyPanes({ ...ws, layout, focusedPane: dest });
}

/**
 * Split pane `target` on its `edge` and move `ids` into the new half.
 * Nothing happens where it would leave the target pane empty: a pane's
 * tabs cannot all leave it for a split of itself.
 */
export function splitPane(
  ws: Workspace,
  ids: readonly string[],
  target: PaneId,
  edge: Edge,
  activate?: string
): Workspace {
  const pane = panesOf(ws.layout).find((p) => p.id === target);
  const asked = new Set(ids.filter((id) => Object.hasOwn(ws.tabs, id)));
  if (!pane || asked.size === 0) return ws;
  if (pane.order.every((id) => asked.has(id))) return ws;
  const added: PaneNode = {
    kind: 'pane',
    id: nextPaneId(ws.layout),
    order: [],
    activeId: null,
  };
  const layout = insertBeside(ws.layout, target, edge, added);
  return moveToPane(
    { ...ws, layout },
    [...asked],
    added.id,
    undefined,
    activate
  );
}

/**
 * Close pane `id`: its tabs, pins and order kept, go to the end of its
 * neighbour (`closeNeighbour`), which shows the closed pane's active tab
 * and takes focus. The sole pane stays.
 */
export function closePane(ws: Workspace, id: PaneId): Workspace {
  const panes = panesOf(ws.layout);
  const pane = panes.find((p) => p.id === id);
  if (!pane || panes.length < 2) return ws;
  const dest = closeNeighbour(ws.layout, id);
  if (!dest) return ws;
  if (pane.order.length === 0) {
    return {
      ...ws,
      layout: prunePanes(ws.layout, (p) => p.id !== id),
      focusedPane: dest,
    };
  }
  return moveToPane(
    ws,
    pane.order,
    dest,
    undefined,
    pane.activeId ?? undefined
  );
}

export function focusPane(ws: Workspace, id: PaneId): Workspace {
  if (ws.focusedPane === id) return ws;
  return panesOf(ws.layout).some((p) => p.id === id)
    ? { ...ws, focusedPane: id }
    : ws;
}

/** Focus the pane toward `edge` of the focused one, if there is one. */
export function focusToward(ws: Workspace, edge: Edge): Workspace {
  const next = paneToward(ws.layout, focusedPaneOf(ws).id, edge);
  return next ? focusPane(ws, next) : ws;
}

/** Move the focused pane's active tab to the pane toward `edge`, which
 *  takes focus. */
export function moveToward(ws: Workspace, edge: Edge): Workspace {
  const from = focusedPaneOf(ws);
  const next = paneToward(ws.layout, from.id, edge);
  if (!next || from.activeId === null) return ws;
  return moveToPane(ws, [from.activeId], next, undefined, from.activeId);
}

/** Whether splitting `ids` off beside `target` on `edge` would only
 *  rebuild the layout there is: a pane's every tab dropped on the facing
 *  side of the pane beside it lands back in its own place, renamed and
 *  at an even share. Such a drop does nothing. */
export function rebuildsLayout(
  ws: Workspace,
  ids: readonly string[],
  target: PaneId,
  edge: Edge
): boolean {
  const after = dropEmptyPanes(splitPane(ws, ids, target, edge));
  return after !== ws && sameShape(after.layout, ws.layout);
}

function sameShape(a: LayoutNode, b: LayoutNode): boolean {
  if (a.kind === 'pane') {
    return (
      b.kind === 'pane' &&
      a.order.length === b.order.length &&
      a.order.every((id, i) => id === b.order[i])
    );
  }
  return (
    b.kind === 'split' &&
    a.direction === b.direction &&
    a.children.length === b.children.length &&
    a.children.every((c, i) => sameShape(c, b.children[i]!))
  );
}
