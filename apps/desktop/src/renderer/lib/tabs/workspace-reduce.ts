import { standsFor, tabHome, terminalTabId, type Tab } from './tab-identity.js';
import { panesOf, replacePane, resizeSplit } from './layout.js';
import {
  closePane,
  dropEmptyPanes,
  focusPane,
  focusToward,
  moveToPane,
  moveToward,
  splitPane,
} from './pane-moves.js';
import type { TabsAction } from './tabs-model.js';
import {
  focusedPaneOf,
  paneOf,
  stripOf,
  withStrip,
  type PaneId,
  type PaneNode,
  type Strip,
  type Workspace,
} from './workspace.js';

/**
 * The workspace reducer: which pane an action is about, and the actions
 * about the panes themselves. A strip action runs on one pane's strip —
 * the pane holding the tab it names, else the pane it was sent from
 * (`scope`), else the focused one. The reconciliations (`sync-items`,
 * discovery's removals, undismissing) run on every pane at once, as one
 * strip, so a tab open in one pane is open everywhere; a tab they add
 * goes to the pane holding its group, else the focused one.
 */

/** An action, and the pane that sent it: a strip's own controls. */
export type WorkspaceAction = TabsAction & { scope?: PaneId };

type ReduceStrip = (state: Strip, action: TabsAction) => Strip;

const ACROSS = new Set<TabsAction['type']>([
  'sync-items',
  'worktrees-removed',
  'undismiss',
]);

export function reduceWorkspace(
  ws: Workspace,
  action: WorkspaceAction,
  reduceStrip: ReduceStrip
): Workspace {
  const next = layoutAction(ws, action) ?? stripAction(ws, action, reduceStrip);
  return next === ws ? ws : settle(next);
}

function layoutAction(ws: Workspace, action: TabsAction): Workspace | null {
  switch (action.type) {
    case 'focus-pane':
      return focusPane(ws, action.pane);
    case 'focus-toward':
      return focusToward(ws, action.edge);
    case 'move-toward':
      return moveToward(ws, action.edge);
    case 'split':
      return splitPane(
        ws,
        action.ids,
        action.target,
        action.edge,
        action.activate
      );
    case 'move-to-pane':
      return moveToPane(
        ws,
        action.ids,
        action.pane,
        action.anchor,
        action.activate
      );
    case 'close-pane':
      return closePane(ws, action.pane);
    case 'resize-split': {
      const layout = resizeSplit(ws.layout, action.key, action.sizes);
      return layout === ws.layout ? ws : { ...ws, layout };
    }
    case 'move':
      return crossPaneMove(ws, action);
    default:
      return null;
  }
}

/** A strip drop onto another pane's tab: the tabs go there, beside it.
 *  `null` for a move within one pane, which the strip makes. */
function crossPaneMove(
  ws: Workspace,
  action: Extract<TabsAction, { type: 'move' }>
): Workspace | null {
  const dest = paneOf(ws, action.targetId);
  const elsewhere = action.ids.some(
    (id) => id in ws.tabs && !dest?.order.includes(id)
  );
  if (!dest || !elsewhere) return null;
  return moveToPane(ws, action.ids, dest.id, {
    targetId: action.targetId,
    side: action.side,
  });
}

/** The tab an action names, and whether bringing it to the front
 *  brings its pane along. */
function namedTab(
  ws: Workspace,
  action: TabsAction
): { id: string | undefined; focus: boolean } | null {
  switch (action.type) {
    case 'activate':
      return { id: action.id, focus: true };
    case 'open-settings':
      return { id: 'settings', focus: true };
    case 'open-terminal':
      return { id: terminalTabId(action.terminal.name), focus: true };
    case 'open-item': {
      const { repo, itemKey } = action;
      const tab = Object.values(ws.tabs).find((t) =>
        standsFor(t, repo, itemKey)
      );
      return { id: tab?.id, focus: true };
    }
    case 'close':
    case 'close-others':
    case 'keep':
      return { id: action.id, focus: false };
    case 'terminal-ended':
      return { id: terminalTabId(action.name), focus: false };
    case 'set-pinned':
    case 'move':
      return { id: action.ids[0], focus: false };
    default:
      return null;
  }
}

/** The pane whose strip `action` runs on, and whether it takes focus:
 *  a tab brought to the front in another pane brings its pane along. */
function addressed(
  ws: Workspace,
  action: WorkspaceAction
): { pane: PaneId; focus: boolean } {
  const sent = action.scope ?? ws.focusedPane;
  const named = namedTab(ws, action);
  const pane = named?.id === undefined ? undefined : paneOf(ws, named.id);
  return pane && named
    ? { pane: pane.id, focus: named.focus }
    : { pane: sent, focus: false };
}

function stripAction(
  ws: Workspace,
  action: WorkspaceAction,
  reduceStrip: ReduceStrip
): Workspace {
  if (ACROSS.has(action.type)) return across(ws, action, reduceStrip);
  const { pane, focus } = addressed(ws, action);
  const strip = stripOf(ws, pane);
  const next = reduceStrip(strip, action);
  if (next === strip) return focus ? focusPane(ws, pane) : ws;
  const out = withStrip(ws, pane, next);
  return focus ? { ...out, focusedPane: pane } : out;
}

/** Every pane's tabs as one strip, in reading order, active where the
 *  focused pane is. */
function combined(ws: Workspace): Strip {
  const strip = stripOf(ws, focusedPaneOf(ws).id);
  const tabs = panesOf(ws.layout).flatMap((p) =>
    p.order.flatMap((id) => ws.tabs[id] ?? [])
  );
  return { ...strip, tabs, others: [] };
}

/** The pane a tab a reconciliation opened goes to: the focused pane
 *  when it holds the tab's group, else the pane holding most of it
 *  (the first, on a tie), else the focused pane. */
function placeFor(
  ws: Workspace,
  groupOf: ((tab: Tab) => string | null) | undefined
): (tab: Tab) => PaneId {
  const focused = focusedPaneOf(ws).id;
  const panes = panesOf(ws.layout);
  if (!groupOf || panes.length < 2) return () => focused;
  return (tab) => {
    const key = groupOf(tab);
    if (key === null) return focused;
    let best: { id: PaneId; n: number } | null = null;
    for (const p of panes) {
      const n = p.order.filter((id) => {
        const t = ws.tabs[id];
        return t !== undefined && groupOf(t) === key;
      }).length;
      if (n === 0) continue;
      if (p.id === focused) return focused;
      if (!best || n > best.n) best = { id: p.id, n };
    }
    return best?.id ?? focused;
  };
}

function across(
  ws: Workspace,
  action: TabsAction,
  reduceStrip: ReduceStrip
): Workspace {
  const before = combined(ws);
  const after = reduceStrip(before, action);
  if (after === before) return ws;
  const groupOf = action.type === 'sync-items' ? action.groupOf : undefined;
  return distribute(ws, after, placeFor(ws, groupOf));
}

/** The pane's active tab once its order is `order`: the one it had,
 *  else the tab that slid into its place, else the one before. */
function keptActive(pane: PaneNode, order: readonly string[]): string | null {
  if (pane.activeId === null || order.includes(pane.activeId)) {
    return pane.activeId;
  }
  const at = pane.order.indexOf(pane.activeId);
  const live = new Set(order);
  const after = pane.order.slice(at + 1).find((id) => live.has(id));
  const before = pane.order
    .slice(0, at)
    .reverse()
    .find((id) => live.has(id));
  return after ?? before ?? null;
}

/**
 * `ws` with the combined strip `after` dealt back out to the panes: a
 * tab that was in a pane stays there, in the strip's order; a new one
 * goes where `place` says. The strip's active tab is the focused pane's
 * when it is there or none (the repository in view has nothing left);
 * a pane left with none takes it when it landed there. Focus stays: a reconciliation is no reason to move it.
 */
function distribute(
  ws: Workspace,
  after: Strip,
  place: (tab: Tab) => PaneId
): Workspace {
  const home = new Map<string, PaneId>();
  for (const p of panesOf(ws.layout)) {
    for (const id of p.order) home.set(id, p.id);
  }
  const paneFor = (tab: Tab) => home.get(tab.id) ?? place(tab);
  const { tabs: list, activeId, ...marks } = after;
  const rest = { ...marks };
  delete rest.others;
  const landed = list.find((t) => t.id === activeId);
  const landedIn = landed ? paneFor(landed) : null;
  let layout = ws.layout;
  for (const pane of panesOf(ws.layout)) {
    const order = list.filter((t) => paneFor(t) === pane.id).map((t) => t.id);
    const kept = keptActive(pane, order);
    const focused = pane.id === ws.focusedPane;
    const takes =
      (focused && activeId === null) ||
      (landedIn === pane.id && (focused || kept === null));
    const active = takes ? activeId : kept;
    layout = replacePane(layout, pane.id, { ...pane, order, activeId: active });
  }
  const tabs = Object.fromEntries(list.map((t) => [t.id, t]));
  // A pin goes with its tab, as `withStrip` has it.
  const pinned = rest.pinned.filter((id) => id in tabs);
  return {
    ...ws,
    ...rest,
    pinned: pinned.length === rest.pinned.length ? rest.pinned : pinned,
    tabs,
    layout,
  };
}

/** What holds after every action: no empty pane but a sole one, focus
 *  on a pane that exists, no pane's active tab still unseen — every
 *  pane shows its active tab — and the focused pane's active tab noted
 *  as where its repository was left, however focus got there. */
function settle(ws: Workspace): Workspace {
  const next = dropEmptyPanes(ws);
  const shown = new Set(panesOf(next.layout).map((p) => p.activeId));
  const unseen = next.unseen.filter((id) => !shown.has(id));
  const seen =
    unseen.length === next.unseen.length ? next : { ...next, unseen };
  return remembered(seen);
}

function remembered(ws: Workspace): Workspace {
  const activeId = focusedPaneOf(ws).activeId;
  const active = activeId === null ? undefined : ws.tabs[activeId];
  const home = active ? tabHome(active) : null;
  if (!active || home === null || ws.lastActiveByRepo[home] === active.id) {
    return ws;
  }
  return {
    ...ws,
    lastActiveByRepo: { ...ws.lastActiveByRepo, [home]: active.id },
  };
}
