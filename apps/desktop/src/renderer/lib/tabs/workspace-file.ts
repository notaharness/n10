import type { SavedWorkspace } from '../../../host/contract.js';
import type { Tab, TerminalTab } from './tab-identity.js';
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
          order: node.order.filter((id) => id in tabs),
          activeId:
            node.activeId && node.activeId in tabs ? node.activeId : null,
        }
      : { ...node, children: node.children.map(keep) };
  return {
    tabs,
    layout: keep(ws.layout),
    focusedPane: ws.focusedPane,
    pinned: ws.pinned.filter((id) => id in tabs),
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
    ...(str(v.machine) ? { machine: v.machine } : {}),
    restored: true,
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

function restoredTabs(v: unknown): Record<string, Tab> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(
    Object.entries(v).flatMap(([id, raw]) => {
      const tab = restoredTab(raw);
      return tab && tab.id === id ? [[id, tab]] : [];
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
  const order = [...new Set(panes.flatMap((p) => p.order))].filter(
    (id) => id in tabs
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

/** The workspace a saved one describes; the empty one for `null`. */
export function restoreWorkspace(saved: SavedWorkspace | null): Workspace {
  if (!saved) return EMPTY_WORKSPACE;
  const all = restoredTabs(saved.tabs);
  const pane = onePane(savedPanes(saved.layout), saved.focusedPane, all);
  const tabs = Object.fromEntries(pane.order.map((id) => [id, all[id]]));
  return {
    ...EMPTY_WORKSPACE,
    tabs,
    layout: pane,
    focusedPane: pane.id,
    pinned: strings(saved.pinned, (id) => id in tabs),
    collapsed: recordOf(saved.collapsed, bool),
    dismissed: strings(saved.dismissed),
    groupNames: recordOf(saved.groupNames, str),
    lastActiveByRepo: recordOf(saved.lastActiveByRepo, str),
  };
}
