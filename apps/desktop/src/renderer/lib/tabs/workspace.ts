import type { Tab } from './tab-identity.js';

/**
 * The editor area's whole state: every tab, the panes that hold them,
 * and what the user decided about them — pins, collapsed groups, agents
 * closed on purpose, group names. What is saved to `workspace.json`
 * (`workspace-file.ts`), less `unseen`.
 *
 * The layout is a tree of splits over panes, each pane with its own
 * order and active tab. Today it is always one pane; the shape is the
 * final one so that splitting needs no migration of a saved file.
 */

export type PaneId = string;

export interface PaneNode {
  kind: 'pane';
  id: PaneId;
  /** The pane's tabs, in strip order, by id. */
  order: readonly string[];
  activeId: string | null;
}

export interface SplitNode {
  kind: 'split';
  direction: 'row' | 'column';
  /** Two or more. */
  children: readonly LayoutNode[];
  /** One per child, summing to 1. */
  sizes: readonly number[];
}

export type LayoutNode = SplitNode | PaneNode;

export interface Workspace {
  tabs: Readonly<Record<string, Tab>>;
  layout: LayoutNode;
  focusedPane: PaneId;
  /** Pinned tabs, a flag set: their order is their panes' order. A
   *  pinned tab sits at its pane's start, outside its group. */
  pinned: readonly string[];
  /** Each group the user collapsed (`true`) or expanded (`false`), by
   *  affiliation key; a group with no entry takes `initiallyCollapsed`
   *  (`tab-groups.ts`). Global, not per pane. */
  collapsed: Readonly<Record<string, boolean>>;
  /** Sessions whose tab was closed while they still ran
   *  (`dismissKeyOf`): every running agent has a tab unless it is here.
   *  A key is dropped once a listing no longer has the session alive,
   *  so the list stays as short as the sessions running. */
  dismissed: readonly string[];
  /** What the user renamed a group to, by affiliation key. */
  groupNames: Readonly<Record<string, string>>;
  /** Tabs opened in the background — an agent that started outside
   *  the app while the user was looking at something else — and not
   *  activated since. The strip marks them until they are first seen.
   *  Not saved. */
  unseen: readonly string[];
  /** The tab each repository was last looked at on, by repo root. Lets
   *  opening a repository again land where it was left rather than on
   *  whichever of its tabs happens to be rightmost. */
  lastActiveByRepo: Readonly<Record<string, string>>;
}

export const FIRST_PANE: PaneId = 'pane-1';

export const EMPTY_WORKSPACE: Workspace = {
  tabs: {},
  layout: { kind: 'pane', id: FIRST_PANE, order: [], activeId: null },
  focusedPane: FIRST_PANE,
  pinned: [],
  collapsed: {},
  dismissed: [],
  groupNames: {},
  unseen: [],
  lastActiveByRepo: {},
};

/** Every pane in the layout, depth first. */
export function panesOf(layout: LayoutNode): PaneNode[] {
  return layout.kind === 'pane' ? [layout] : layout.children.flatMap(panesOf);
}

/** The pane that has focus, or the first one if the id names none. */
export function focusedPaneOf(ws: Workspace): PaneNode {
  const panes = panesOf(ws.layout);
  return panes.find((p) => p.id === ws.focusedPane) ?? panes[0];
}

/**
 * One pane's strip with the workspace's bookkeeping beside it: the
 * shape every reducer pass works on. A pass reads and writes a pane's
 * tabs as one ordered list and its active tab, and the workspace-wide
 * sets as they are.
 */
export type Strip = Omit<Workspace, 'tabs' | 'layout' | 'focusedPane'> & {
  tabs: Tab[];
  activeId: string | null;
};

export const EMPTY_STRIP: Strip = stripOf(EMPTY_WORKSPACE, FIRST_PANE);

export function stripOf(ws: Workspace, paneId: PaneId): Strip {
  const pane = panesOf(ws.layout).find((p) => p.id === paneId);
  return {
    pinned: ws.pinned,
    collapsed: ws.collapsed,
    dismissed: ws.dismissed,
    groupNames: ws.groupNames,
    unseen: ws.unseen,
    lastActiveByRepo: ws.lastActiveByRepo,
    tabs: (pane?.order ?? []).flatMap((id) => ws.tabs[id] ?? []),
    activeId: pane?.activeId ?? null,
  };
}

function replacePane(node: LayoutNode, id: PaneId, next: PaneNode): LayoutNode {
  if (node.kind === 'pane') return node.id === id ? next : node;
  return {
    ...node,
    children: node.children.map((c) => replacePane(c, id, next)),
  };
}

/**
 * `ws` with pane `paneId` holding `strip`: the pane's order and active
 * tab, its tabs (any it no longer holds are gone), and the bookkeeping.
 * A pin on a tab that no longer exists goes with it.
 */
export function withStrip(
  ws: Workspace,
  paneId: PaneId,
  strip: Strip
): Workspace {
  const pane = panesOf(ws.layout).find((p) => p.id === paneId);
  const { tabs: list, activeId, ...rest } = strip;
  const left = new Set(pane?.order);
  const tabs: Record<string, Tab> = Object.fromEntries(
    Object.entries(ws.tabs).filter(([id]) => !left.has(id))
  );
  for (const tab of list) tabs[tab.id] = tab;
  const order = list.map((t) => t.id);
  const pinned = rest.pinned.filter((id) => id in tabs);
  return {
    ...ws,
    ...rest,
    pinned: pinned.length === rest.pinned.length ? rest.pinned : pinned,
    tabs,
    layout: replacePane(ws.layout, paneId, {
      kind: 'pane',
      id: paneId,
      order,
      activeId,
    }),
  };
}
