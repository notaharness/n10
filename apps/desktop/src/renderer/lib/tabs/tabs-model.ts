/**
 * Editor-area tab model (VS Code semantics, simplified):
 *   • `item` tabs are keyed by *repository plus* sidebar item key; one
 *     tab per item.
 *   • A single-click opens a *preview* tab (italic title) that gets
 *     replaced by the next preview in the same repository;
 *     double-click or any interaction pins it.
 *   • `settings` is a singleton tab, and belongs to no repository.
 *
 * The strip outlives the open repository: opening another repo leaves
 * the previous one's tabs in place so their agents stay in sight. Every
 * action that names a repository therefore carries it explicitly, and
 * `sync-items` only ever reconciles the tabs of the repo it was given —
 * two repos routinely share branch names and so share item keys.
 */

import { tabHome, terminalTabId, type Tab } from './tab-identity.js';
import type { Edge } from './layout.js';
import type { Anchor } from './pane-moves.js';

export type { ItemTab, Tab, TerminalTab } from './tab-identity.js';
export type { TerminalEntry } from './tab-terminals.js';
export type { ForeignSessionEntry } from './tab-foreign.js';
export type { PaneId, Strip, Workspace } from './workspace.js';
export type { WorkspaceAction } from './workspace-reduce.js';
export { EMPTY_STRIP, EMPTY_WORKSPACE } from './workspace.js';
import {
  closeOtherTabs,
  closeRemovedWorktrees,
  closeTab,
  closeUnpinned,
} from './tab-close.js';
import { dismissClosed, pruneDismissed, undismiss } from './tab-dismissed.js';
import { openForeign, type ForeignSessionEntry } from './tab-foreign.js';
import { openItem, openRunning, openSettings } from './tab-open.js';
import {
  assignOrdinals,
  presentationOrder,
  type LabelAction,
} from './tab-label-state.js';
import { pinLive, rekey } from './tab-sync.js';
import {
  arrangeTabs,
  focusRepo,
  keepTab,
  moveTabs,
  renameGroup,
  setCollapsed,
  setPinned,
} from './tab-order.js';
import {
  openTerminal,
  syncTerminals,
  type TerminalEntry,
} from './tab-terminals.js';
import { reduceWorkspace, type WorkspaceAction } from './workspace-reduce.js';
import type { PaneId, Strip, Workspace } from './workspace.js';

/** One sidebar item as the tab model needs it. */
export interface ItemEntry {
  itemKey: string;
  branch: string;
  /** What the item is called on screen; remembered on the tab. */
  title?: string;
  /** Whether an agent is live on this item right now. */
  running?: boolean;
  /** PTY session name, when the item has one. Present on every
   *  worktree row whether or not an agent was ever started, so it says
   *  nothing about liveness on its own — `running` does. */
  sessionName?: string;
  /** The worktree checkout the item lives in, when it has one. */
  worktree?: string;
  /** The branch the item's agent session was created for, when the
   *  worktree has since switched to another. */
  sessionBranch?: string;
}

/** The repository the active tab belongs to, if it belongs to one. A
 *  plain-folder terminal belongs to none, so activating it switches
 *  nothing. */
export function activeTabRepo(state: Strip): string | null {
  const active = state.tabs.find((t) => t.id === state.activeId);
  return active ? tabHome(active) : null;
}

/** What one sync reconciles the strip against; each `undefined` until
 *  its source has answered. */
export interface SyncListings {
  entries?: ItemEntry[];
  terminals?: TerminalEntry[];
  foreign?: ForeignSessionEntry[];
  alive?: readonly string[];
  scanned?: readonly string[];
}

export type TabsAction =
  | { type: 'open-item'; repo: string; itemKey: string; preview: boolean }
  | { type: 'open-settings' }
  /** End a tab's preview: the next single click no longer replaces it. */
  | { type: 'keep'; id: string }
  /** Pin or unpin tabs. A pinned tab sits at its pane's start, outside
   *  its group; pinning a preview keeps it. */
  | { type: 'set-pinned'; ids: readonly string[]; pinned: boolean }
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string; repo?: string }
  | { type: 'close-active' }
  | { type: 'close-others'; id: string }
  /** Close every tab but the pinned ones. `repo` is the one in view, for
   *  where focus goes if the active tab closes. */
  | { type: 'close-all'; repo?: string }
  /** Place `ids`, in their order, before or after `targetId`: one tab,
   *  or a whole group dragged by its chip. */
  | {
      type: 'move';
      ids: readonly string[];
      targetId: string;
      side: 'before' | 'after';
    }
  /** Put the tabs `ids` name in that order, the rest after them: the
   *  strip as presented, with a dragged block in its new place. */
  | { type: 'arrange'; ids: readonly string[] }
  /** Collapse (or expand) these groups. */
  | { type: 'set-collapsed'; keys: readonly string[]; collapsed: boolean }
  /** Name a group, by affiliation key; `null` (or a blank name) gives it
   *  back its derived label. */
  | { type: 'rename-group'; key: string; name: string | null }
  | LabelAction
  /** The one reconciliation dispatched from Workspace's effect: the
   *  repo's sidebar items *and* the host's terminal listing, applied as
   *  one pure step. Terminals ride along on every sync rather than
   *  getting a dispatch of their own — carrying an empty `entries` still
   *  reconciles the terminal strip on its own, since an empty list is a
   *  no-op for the item passes.
   *
   *  `terminals` is the host's answer, and `undefined` is no answer
   *  yet — not an empty one. The listing is authoritative when it is
   *  there: a terminal tab it does not name has ended and closes. With
   *  no listing the terminal tabs are left exactly as they are, so a
   *  tick before the first answer cannot close every one of them.
   *
   *  `foreign` is the host's other listing: agents alive in *other*
   *  repositories, each of which gets a tab in its own group unless it
   *  was dismissed (see `tab-foreign.ts`). Also `undefined` before the
   *  first answer, and so is `entries` before the sidebar's.
   *
   *  `alive` names every agent session tmux runs on this machine, any
   *  repository's: only it says a dismissed agent ended. `scanned` are
   *  the machines whose terminal listing is complete; a restored or
   *  dismissed terminal of any other machine waits.
   *
   *  `groupOf` is the group a tab belongs to (its affiliation key), so a
   *  tab this opens joins the pane already holding its group's players
   *  (`isHome` tells its orchestrator's own tab from them), or the pane
   *  following it. */
  | ({
      type: 'sync-items';
      repo: string;
      groupOf?: (tab: Tab) => string | null;
      isHome?: (tab: Tab) => boolean;
    } & SyncListings)
  /** Open (or activate) the tab for a terminal the host just started. */
  | { type: 'open-terminal'; terminal: TerminalEntry }
  /** The host says the process behind a terminal ended, by name — the
   *  shell exited, the agent quit, tmux ended the session. Its tab
   *  closes on that word alone, whether or not a listing ever named it:
   *  a process that died between the launch answer and the first
   *  listing would otherwise leave a tab whose close asks to end a
   *  session that is already gone. Focus follows the close rules for
   *  `repo`, the one in view. A name with no terminal tab is nothing. */
  | { type: 'terminal-ended'; name: string; repo?: string }
  /** Discovery says these checkouts of `repo` are gone — removed by
   *  n10, with `git worktree remove`, or deleted from disk. Their tabs
   *  close: nothing is left to show in them. */
  | { type: 'worktrees-removed'; repo: string; worktrees: string[] }
  /** A repository was opened. Dispatched for every open, tab-driven or
   *  not; it only does something when the tab in front of the user
   *  belongs to somewhere else. */
  | { type: 'repo-opened'; repo: string }
  /** Give these dismissed sessions (`dismissKeyOf`) their tabs back on
   *  the next sync: the user asked for a closed agent again, or a
   *  close's kill failed and left it running behind no tab. */
  | { type: 'undismiss'; keys: readonly string[] }
  | PaneAction;

/** What the user does to the panes (`pane-moves.ts`). None of them
 *  opens, closes or stops a tab. */
type PaneAction =
  /** The user is in this pane now. */
  | { type: 'focus-pane'; pane: PaneId }
  | { type: 'focus-toward'; edge: Edge }
  /** Move the focused pane's active tab to the pane toward `edge`. */
  | { type: 'move-toward'; edge: Edge }
  /** Split pane `target` on its `edge`, moving `ids` into the new half;
   *  it shows `activate` when that is among them. */
  | {
      type: 'split';
      ids: readonly string[];
      target: PaneId;
      edge: Edge;
      activate?: string;
    }
  /** Move `ids` into pane `pane`, beside `anchor` or at its end. */
  | {
      type: 'move-to-pane';
      ids: readonly string[];
      pane: PaneId;
      anchor?: Anchor;
      activate?: string;
    }
  /** Close a pane, its tabs going to its neighbour. */
  | { type: 'close-pane'; pane: PaneId }
  /** The user resized the split `key` (`splitKey`). */
  | { type: 'resize-split'; key: string; sizes: readonly number[] }
  | SuperviseAction;

/** The supervising layouts (`supervise.ts`). */
type SuperviseAction =
  /** Move group `key`'s `players` from pane `pane` to a new pane on its
   *  `edge`, leaving its `home` there. */
  | {
      type: 'tile-group';
      pane: PaneId;
      key: string;
      home: string;
      players: readonly string[];
      edge: Edge;
    }
  /** Follow group `key` in a new pane on `pane`'s `edge` holding those
   *  of `ids` in `pane`; it shows `show`. */
  | {
      type: 'follow-group';
      pane: PaneId;
      key: string;
      ids: readonly string[];
      edge: Edge;
      show: string;
    }
  | { type: 'stop-following'; pane: PaneId }
  /** A follow pane's own switch: it shows `id`, and focus stays. */
  | { type: 'follow-show'; pane: PaneId; id: string };

/** Activate a tab, ignoring an id that is no longer on the strip. */
function activateTab(state: Strip, id: string): Strip {
  return state.tabs.some((t) => t.id === id)
    ? { ...state, activeId: id }
    : state;
}

/** The workspace after `action` (`workspace-reduce.ts`). The same
 *  workspace object when nothing changed. */
export function reduce(ws: Workspace, action: WorkspaceAction): Workspace {
  return reduceWorkspace(ws, action, reduceStrip);
}

/** One pane's strip after `action`: every transition the reducer has. */
export function reduceStrip(state: Strip, action: TabsAction): Strip {
  return presentationOrder(state, remember(markSeen(apply(state, action))));
}

/**
 * Drop the active tab, and every tab no longer on the strip, from
 * `unseen`. Derived for the same reason `remember` is: every path that
 * activates or closes a tab passes through here.
 */
function markSeen(state: Strip): Strip {
  if (state.unseen.length === 0) return state;
  const open = new Set(state.tabs.map((t) => t.id));
  const unseen = state.unseen.filter(
    (id) => id !== state.activeId && open.has(id)
  );
  return unseen.length === state.unseen.length ? state : { ...state, unseen };
}

/**
 * Note which tab the active repository was left on.
 *
 * Derived rather than dispatched, so no action can forget to do it —
 * every path that moves `activeId` passes through here.
 */
function remember(state: Strip): Strip {
  const active = state.tabs.find((t) => t.id === state.activeId);
  const home = active ? tabHome(active) : null;
  if (!active || home === null) return state;
  if (state.lastActiveByRepo[home] === active.id) return state;
  return {
    ...state,
    lastActiveByRepo: { ...state.lastActiveByRepo, [home]: active.id },
  };
}

/** The actions that take tabs off the strip. */
type CloseAction = Extract<
  TabsAction,
  {
    type:
      | 'close'
      | 'close-others'
      | 'close-all'
      | 'close-active'
      | 'terminal-ended'
      | 'worktrees-removed';
  }
>;

const CLOSE_ACTIONS: ReadonlySet<TabsAction['type']> = new Set<
  CloseAction['type']
>([
  'close',
  'close-active',
  'close-others',
  'close-all',
  'terminal-ended',
  'worktrees-removed',
]);

function isCloseAction(action: TabsAction): action is CloseAction {
  return CLOSE_ACTIONS.has(action.type);
}

/** A close, with every session it closed a tab on dismissed: closed on
 *  purpose, or by the host and discovery on the session's behalf, a
 *  session still running stays without a tab until it ends. */
function applyClose(state: Strip, action: CloseAction): Strip {
  return dismissClosed(state, closed(state, action));
}

function closed(state: Strip, action: CloseAction): Strip {
  switch (action.type) {
    case 'close':
      return closeTab(state, action.id, action.repo);
    case 'close-active':
      return state.activeId
        ? closeTab(state, state.activeId, undefined)
        : state;
    case 'terminal-ended':
      return closeTab(state, terminalTabId(action.name), action.repo);
    case 'worktrees-removed':
      return closeRemovedWorktrees(state, action.repo, action.worktrees);
    case 'close-others':
      return closeOtherTabs(state, action.id);
    case 'close-all':
      return closeUnpinned(state, action.repo);
  }
}

/** The actions about item and settings tabs — the strip as it was
 *  before terminals joined it, minus the closes. `sync-items` stays in
 *  this union: its item passes (`applyStrip`'s case below) read only
 *  `repo`/`entries`, and the `terminals` field rides along for
 *  {@link apply} to hand to `syncTerminals` once the item passes have
 *  settled. */
type StripAction = Exclude<TabsAction, { type: 'open-terminal' } | CloseAction>;

function apply(state: Strip, action: TabsAction): Strip {
  if (action.type === 'open-terminal') {
    return openTerminal(state, action.terminal);
  }
  if (isCloseAction(action)) {
    return applyClose(state, action);
  }
  if (action.type === 'sync-items') {
    // One dispatch, one pure step: the repo's items and the host's
    // terminal listing are reconciled together rather than from two
    // effects racing into the reducer separately.
    const strip = applyStrip(state, action);
    const withTerminals = action.terminals
      ? syncTerminals(strip, action.repo, action.terminals, action.scanned)
      : strip;
    const withForeign = action.foreign
      ? openForeign(withTerminals, action.repo, action.foreign)
      : withTerminals;
    return pruneDismissed(withForeign, action);
  }
  return applyStrip(state, action);
}

/** The user's marks on tabs and groups, short of opening and closing. */
type MarkAction = Extract<
  TabsAction,
  {
    type:
      | 'keep'
      | 'set-pinned'
      | 'rename-group'
      | 'move'
      | 'arrange'
      | 'set-collapsed';
  }
>;

const MARK_ACTIONS: ReadonlySet<TabsAction['type']> = new Set<
  MarkAction['type']
>(['keep', 'set-pinned', 'rename-group', 'move', 'arrange', 'set-collapsed']);

function applyMark(state: Strip, action: MarkAction): Strip {
  switch (action.type) {
    case 'keep':
      return keepTab(state, action.id);
    case 'set-pinned':
      return setPinned(state, action.ids, action.pinned);
    case 'rename-group':
      return renameGroup(state, action.key, action.name);
    case 'move':
      return moveTabs(state, action.ids, action.targetId, action.side);
    case 'arrange':
      return arrangeTabs(state, action.ids);
    case 'set-collapsed':
      return setCollapsed(state, action.keys, action.collapsed);
  }
}

function applyStrip(state: Strip, action: StripAction): Strip {
  if (
    action.type === 'assign-collision-ordinals' ||
    action.type === 'assign-chip-ordinals'
  )
    return assignOrdinals(state, action);
  if (MARK_ACTIONS.has(action.type)) {
    return applyMark(state, action as MarkAction);
  }
  switch (action.type) {
    case 'open-item':
      return openItem(state, action.repo, action.itemKey, action.preview);
    case 'open-settings':
      return openSettings(state);
    case 'activate':
      return activateTab(state, action.id);
    case 'sync-items': {
      const entries = action.entries ?? [];
      return pinLive(
        openRunning(
          rekey(state, action.repo, entries),
          action.repo,
          entries,
          // The strip as the user last saw it, beside the re-keyed one:
          // see `openRunning`.
          state.tabs
        ),
        action.repo,
        entries
      );
    }
    case 'repo-opened':
      return focusRepo(state, action.repo);
    case 'undismiss':
      return undismiss(state, action.keys);
    default:
      return state;
  }
}
