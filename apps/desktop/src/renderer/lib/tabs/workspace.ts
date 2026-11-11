import type { Tab } from './tab-identity.js';
import { panesOf, replacePane } from './layout.js';

export { panesOf } from './layout.js';

/**
 * The editor area's whole state: every tab, the panes that hold them,
 * and what the user decided about them — pins, collapsed groups, agents
 * closed on purpose, group names. What is saved to `workspace.json`
 * (`workspace-file.ts`), less `unseen`.
 *
 * The layout is a tree of splits over panes, each pane with its own
 * order and active tab (`layout.ts`). Every tab is in exactly one pane,
 * and a pane with no tabs is only ever the sole one.
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
  /** Its name for as long as it stands (`split-N`), whatever its
   *  children do. */
  id: string;
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
  /** The panes following a group (`supervise.ts`): at most one pane
   *  per group. Not saved, so following ends with the run. */
  follows: Readonly<Record<PaneId, Following>>;
}

/** What a follow pane follows: a group, by affiliation key, and the
 *  tabs of it the pane holds and switches between. A tab leaves `ids`
 *  when it is pinned, moved out or closed, and joins it when a sync
 *  opens it there; with none left, following ends. */
export interface Following {
  key: string;
  ids: readonly string[];
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
  follows: {},
};

/** The pane that has focus, or the first one if the id names none. */
export function focusedPaneOf(ws: Workspace): PaneNode {
  const panes = panesOf(ws.layout);
  return panes.find((p) => p.id === ws.focusedPane) ?? panes[0]!;
}

/** The pane that holds tab `id`, if any does. */
export function paneOf(ws: Workspace, id: string): PaneNode | undefined {
  return panesOf(ws.layout).find((p) => p.order.includes(id));
}

/**
 * One pane's strip with the workspace's bookkeeping beside it: the
 * shape every reducer pass works on. A pass reads and writes a pane's
 * tabs as one ordered list and its active tab, and the workspace-wide
 * sets as they are.
 */
export type Strip = Omit<
  Workspace,
  'tabs' | 'layout' | 'focusedPane' | 'follows'
> & {
  tabs: Tab[];
  activeId: string | null;
  /** The tabs in the other panes, read only: an open must not take an
   *  id one of them already has. */
  others?: readonly Tab[];
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
    others: panesOf(ws.layout)
      .filter((p) => p.id !== paneId)
      .flatMap((p) => p.order.flatMap((id) => ws.tabs[id] ?? [])),
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
  const { tabs: list, activeId, ...marks } = strip;
  const rest = { ...marks };
  delete rest.others;
  const left = new Set(pane?.order);
  const tabs: Record<string, Tab> = Object.fromEntries(
    Object.entries(ws.tabs).filter(([id]) => !left.has(id))
  );
  for (const tab of list) tabs[tab.id] = tab;
  const order = list.map((t) => t.id);
  const pinned = rest.pinned.filter((id) => Object.hasOwn(tabs, id));
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
