import type { SavedWorkspace } from '../../../host/contract.js';
import {
  itemTabId,
  terminalTabId,
  type Tab,
  type TerminalTab,
} from './tab-identity.js';
import { COLLAPSED_LIMIT } from './tab-order.js';
import {
  EMPTY_WORKSPACE,
  FIRST_PANE,
  type LayoutNode,
  type PaneNode,
  type Workspace,
} from './workspace.js';

/**
 * The workspace as `workspace.json` holds it, and back.
 *
 * Saved: everything but `unseen`, and a terminal tab only once a listing
 * has told it its session's creation time — the one thing that tells
 * the session apart from a later one under the same name.
 *
 * Restored: every field is checked, and what does not hold is dropped
 * rather than trusted, so a hand-edited or half-understood file costs a
 * tab, never the window. Terminal tabs come back `restored`, waiting
 * for a listing to bind them (`tab-terminals.ts`); item tabs reconcile
 * on the first sync like any other. This build shows one pane: a saved
 * layout of several is read into one, in order.
 */

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const str = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown): boolean => v === undefined || str(v);
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
/** Own keys only: an id such as `constructor` is no tab. */
const has = (record: object, key: string): boolean =>
  Object.hasOwn(record, key);

function savedTab(tab: Tab): Tab | null {
  if (tab.kind !== 'terminal') return tab;
  if (tab.created === undefined) return null;
  const saved: TerminalTab = { ...tab, listed: false };
  delete saved.restored;
  return saved;
}

export function toSaved(ws: Workspace): SavedWorkspace {
  const tabs = Object.fromEntries(
    Object.values(ws.tabs).flatMap((t) => {
      const saved = savedTab(t);
      return saved ? [[saved.id, saved]] : [];
    })
  );
  const keep = (node: LayoutNode): LayoutNode =>
    node.kind === 'pane'
      ? {
          ...node,
          order: node.order.filter((id) => has(tabs, id)),
          activeId:
            node.activeId && has(tabs, node.activeId) ? node.activeId : null,
        }
      : { ...node, children: node.children.map(keep) };
  return {
    tabs,
    layout: keep(ws.layout),
    focusedPane: ws.focusedPane,
    pinned: ws.pinned.filter((id) => has(tabs, id)),
    collapsed: ws.collapsed,
    dismissed: ws.dismissed,
    groupNames: ws.groupNames,
    lastActiveByRepo: ws.lastActiveByRepo,
  };
}

const ITEM_FIELDS = [
  'branch',
  'worktree',
  'originBranch',
  'title',
  'session',
] as const;

function itemTab(v: Json): Tab | null {
  if (!str(v.id) || !str(v.repo) || !str(v.itemKey)) return null;
  // Opened on an item of its repository; re-keying keeps that id.
  if (!v.id.startsWith(itemTabId(v.repo, ''))) return null;
  if (!bool(v.preview) || !ITEM_FIELDS.every((f) => optStr(v[f]))) return null;
  const tab: Tab = {
    id: v.id,
    kind: 'item',
    repo: v.repo,
    itemKey: v.itemKey,
    preview: v.preview,
  };
  for (const f of ITEM_FIELDS) if (str(v[f])) tab[f] = v[f];
  return tab;
}

function terminalTab(v: Json): Tab | null {
  const { id, name, cwd, displayPath, repo, created, terminalKind } = v;
  if (!str(id) || !str(name) || !str(cwd) || !str(displayPath)) return null;
  if (id !== terminalTabId(name)) return null;
  if (terminalKind !== 'shell' && terminalKind !== 'agent') return null;
  if (typeof created !== 'number' || (repo !== null && !str(repo))) return null;
  return {
    id,
    kind: 'terminal',
    name,
    terminalKind,
    cwd,
    displayPath,
    repo,
    preview: false,
    listed: false,
    created,
    ...machineOf(v),
    restored: true,
  };
}

/** The machine a saved terminal tab was on, and its name then. */
function machineOf(v: Json): Pick<TerminalTab, 'machine' | 'machineLabel'> {
  return {
    ...(str(v.machine) ? { machine: v.machine } : {}),
    ...(str(v.machineLabel) ? { machineLabel: v.machineLabel } : {}),
  };
}

function restoredTab(v: unknown): Tab | null {
  if (!isRecord(v)) return null;
  if (v.kind === 'settings') {
    return v.id === 'settings'
      ? { id: 'settings', kind: 'settings', preview: false }
      : null;
  }
  if (v.kind === 'item') return itemTab(v);
  return v.kind === 'terminal' ? terminalTab(v) : null;
}

/** A tab of a repository that is gone from disk: it cannot open. */
const ofGone = (tab: Tab, gone: ReadonlySet<string>) =>
  tab.kind === 'item' && gone.has(tab.repo);

function restoredTabs(
  v: unknown,
  gone: ReadonlySet<string>
): Record<string, Tab> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(
    Object.entries(v).flatMap(([id, raw]) => {
      const tab = restoredTab(raw);
      return tab && tab.id === id && !ofGone(tab, gone) ? [[id, tab]] : [];
    })
  );
}

/** Every pane a saved layout names, depth first; anything malformed is
 *  skipped. */
function savedPanes(v: unknown, depth = 0): PaneNode[] {
  if (!isRecord(v) || depth > 16) return [];
  if (v.kind === 'split' && Array.isArray(v.children)) {
    return v.children.flatMap((c) => savedPanes(c, depth + 1));
  }
  if (v.kind !== 'pane' || !str(v.id) || !Array.isArray(v.order)) return [];
  const activeId = str(v.activeId) ? v.activeId : null;
  return [{ kind: 'pane', id: v.id, order: v.order.filter(str), activeId }];
}

/** One pane holding every saved pane's tabs, in order, each once; active
 *  where the focused saved pane was. */
function onePane(
  panes: PaneNode[],
  focused: unknown,
  tabs: Record<string, Tab>
): PaneNode {
  const order = [...new Set(panes.flatMap((p) => p.order))].filter((id) =>
    has(tabs, id)
  );
  const from = panes.find((p) => p.id === focused) ?? panes[0];
  const activeId =
    from?.activeId && order.includes(from.activeId) ? from.activeId : null;
  return { kind: 'pane', id: FIRST_PANE, order, activeId };
}

function strings(v: unknown, keep: (s: string) => boolean = () => true) {
  return Array.isArray(v) ? [...new Set(v.filter(str).filter(keep))] : [];
}

function recordOf<T>(
  v: unknown,
  is: (x: unknown) => x is T
): Record<string, T> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(
    Object.entries(v).filter(([, x]) => is(x))
  ) as Record<string, T>;
}

/** The workspace a saved one describes; the empty one for `null`. Item
 *  tabs of `goneRepos`, repositories no longer on disk, are left out:
 *  one moved while n10 was closed has its agent's tab back under its
 *  new path when it opens, and a tab for the old path could not open. */
export function restoreWorkspace(
  saved: SavedWorkspace | null,
  goneRepos: readonly string[] = []
): Workspace {
  if (!saved) return EMPTY_WORKSPACE;
  const all = restoredTabs(saved.tabs, new Set(goneRepos));
  const pane = onePane(savedPanes(saved.layout), saved.focusedPane, all);
  const tabs = Object.fromEntries(pane.order.map((id) => [id, all[id]]));
  return {
    ...EMPTY_WORKSPACE,
    tabs,
    layout: pane,
    focusedPane: pane.id,
    pinned: strings(saved.pinned, (id) => has(tabs, id)),
    collapsed: Object.fromEntries(
      Object.entries(recordOf(saved.collapsed, bool)).slice(-COLLAPSED_LIMIT)
    ),
    dismissed: strings(saved.dismissed),
    groupNames: recordOf(saved.groupNames, str),
    lastActiveByRepo: recordOf(saved.lastActiveByRepo, str),
  };
}
