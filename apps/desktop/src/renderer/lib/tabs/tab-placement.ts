import { panesOf } from './layout.js';
import { followerOf } from './supervise.js';
import type { Tab } from './tab-identity.js';
import { focusedPaneOf, type PaneId, type Workspace } from './workspace.js';

/** How a reconciliation tells which group a tab is in, and whether it
 *  is the tab of that group's orchestrator. */
export interface Grouping {
  groupOf: (tab: Tab) => string | null;
  isHome?: (tab: Tab) => boolean;
}

/** The pane a tab a reconciliation opened goes to: the pane following
 *  its group, unless it is the group's home; else the focused pane when
 *  it holds the group's players, else the pane holding most of them (the
 *  first, on a tie); else the focused pane. A player is an unpinned member other than the home, so
 *  a new player of a tiled group joins the players, not the home. */
export function placeFor(
  ws: Workspace,
  grouping: Grouping | undefined
): (tab: Tab) => PaneId {
  const focused = focusedPaneOf(ws).id;
  const panes = panesOf(ws.layout);
  if (!grouping || panes.length < 2) return () => focused;
  const { groupOf, isHome = () => false } = grouping;
  const pinned = new Set(ws.pinned);
  return (tab) => {
    const key = groupOf(tab);
    if (key === null) return focused;
    // A home is never followed: it goes where its group's players are.
    const following = isHome(tab) ? undefined : followerOf(ws, key);
    if (following !== undefined) return following;
    const player = (id: string) => {
      const t = ws.tabs[id];
      return !!t && !pinned.has(id) && groupOf(t) === key && !isHome(t);
    };
    let best: { id: PaneId; n: number } | null = null;
    for (const p of panes) {
      const n = p.order.filter(player).length;
      if (n === 0) continue;
      if (p.id === focused) return focused;
      if (!best || n > best.n) best = { id: p.id, n };
    }
    return best?.id ?? focused;
  };
}
