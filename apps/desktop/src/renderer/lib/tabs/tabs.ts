import { createContext, useContext, useMemo, type Dispatch } from 'react';
import type {
  ForeignSessionEntry,
  ItemEntry,
  Strip,
  Tab,
  TabsAction,
  TerminalEntry,
} from './tabs-model.js';
import { useRepo } from '../repo-context.js';
import { tabOpening } from './tab-identity.js';

export type {
  ForeignSessionEntry,
  ItemEntry,
  ItemTab,
  Strip,
  Tab,
  TabsAction,
  TerminalEntry,
  TerminalTab,
  Workspace,
} from './tabs-model.js';
export { activeTabRepo } from './tabs-model.js';
export {
  foreignRepoOf,
  isForeignTab,
  itemTabId,
  standsFor,
  tabIdFor,
  terminalTabId,
} from './tab-identity.js';

/**
 * The tab strip's api.
 *
 * `openItem` and `syncItems` name the repository they act on, because
 * the provider sits *above* the repo gate — the strip keeps another
 * repository's tabs after you switch away, so it cannot assume every
 * action is about the repo that happens to be open. Components inside
 * a repo workspace use `useRepoTabs`, which fills the repo in.
 *
 * Its fields are the focused pane's strip (`Strip`): that pane's tabs
 * in order and its active tab, beside the workspace-wide sets.
 */
interface TabsApi extends Strip {
  openItem: (
    repo: string,
    itemKey: string,
    opts?: { preview?: boolean }
  ) => void;
  openSettings: () => void;
  /** End a preview: the next single click no longer replaces it. */
  keep: (id: string) => void;
  /** Pin or unpin tabs: pinned, they sit at the pane's start. */
  setPinned: (ids: readonly string[], pinned: boolean) => void;
  activate: (id: string) => void;
  /** `repo` is the one in view: focus never leaves it on a close. */
  close: (id: string, repo?: string) => void;
  closeOthers: (id: string) => void;
  /** Close every unpinned tab; `repo` is the one in view. */
  closeAll: (repo?: string) => void;
  closeActive: () => void;
  /** Drag-reorder within a group: place `ids` before or after
   *  `targetId`. */
  moveTabs: (
    ids: readonly string[],
    targetId: string,
    side: 'before' | 'after'
  ) => void;
  /** Drag-reorder among blocks: the strip's tabs in this order. */
  arrangeTabs: (ids: readonly string[]) => void;
  /** Collapse or expand the groups `keys` name. */
  setCollapsed: (keys: readonly string[], collapsed: boolean) => void;
  /** Name a group, by affiliation key; `null` restores its label. */
  renameGroup: (key: string, name: string | null) => void;
  /**
   * Reconcile the strip with the current sidebar items *and* the host's
   * terminal listing, in one step: follow re-keyed items, open a tab
   * for each newly running agent, pin any preview tab that now has a
   * live agent behind it, and bring the terminal strip in line with
   * what the host lists — closing the tabs of terminals it no longer
   * has. One dispatch, so both reconciliations land in a single render
   * rather than racing from two effects. No `terminals` is no listing
   * yet, which leaves every terminal tab alone; likewise no `entries`
   * is no sidebar yet. `foreign` is the host's listing of agents alive
   * in other repositories, each given a tab in its own group unless
   * dismissed.
   */
  syncItems: (
    repo: string,
    entries: ItemEntry[] | undefined,
    terminals: TerminalEntry[] | undefined,
    foreign: ForeignSessionEntry[] | undefined
  ) => void;
  /** Tell the strip a repository is now the one in view. */
  repoOpened: (repo: string) => void;
  /** Open (or activate) the tab for a terminal the host just started. */
  openTerminal: (terminal: TerminalEntry) => void;
  /** The host says the terminal's process ended: close its tab, listed
   *  or not. `repo` is the one in view, for the close-focus rules. */
  terminalEnded: (name: string, repo?: string) => void;
  /** Give these dismissed sessions (`dismissKeyOf`'s keys) their tabs
   *  back on the next sync: asked for again, or left running by a
   *  close whose kill failed. */
  undismiss: (keys: readonly string[]) => void;
}

export const TabsContext = createContext<TabsApi | null>(null);

export type TabsActions = Omit<TabsApi, keyof Strip>;

/** The strip's actions over its reducer's `dispatch`, none reading
 *  state: made once, they keep their identity for as long as `dispatch`
 *  does, whatever the state does. */
export function tabsActions(dispatch: Dispatch<TabsAction>): TabsActions {
  return {
    openItem: (repo, itemKey, opts) =>
      dispatch({
        type: 'open-item',
        repo,
        itemKey,
        preview: opts?.preview ?? false,
      }),
    openSettings: () => dispatch({ type: 'open-settings' }),
    keep: (id) => dispatch({ type: 'keep', id }),
    setPinned: (ids, pinned) => dispatch({ type: 'set-pinned', ids, pinned }),
    activate: (id) => dispatch({ type: 'activate', id }),
    close: (id, repo) => dispatch({ type: 'close', id, repo }),
    closeOthers: (id) => dispatch({ type: 'close-others', id }),
    closeAll: (repo) => dispatch({ type: 'close-all', repo }),
    closeActive: () => dispatch({ type: 'close-active' }),
    moveTabs: (ids, targetId, side) =>
      dispatch({ type: 'move', ids, targetId, side }),
    arrangeTabs: (ids) => dispatch({ type: 'arrange', ids }),
    setCollapsed: (keys, collapsed) =>
      dispatch({ type: 'set-collapsed', keys, collapsed }),
    renameGroup: (key, name) => dispatch({ type: 'rename-group', key, name }),
    syncItems: (repo, entries, terminals, foreign) =>
      dispatch({ type: 'sync-items', repo, entries, terminals, foreign }),
    repoOpened: (repo) => dispatch({ type: 'repo-opened', repo }),
    openTerminal: (terminal) => dispatch({ type: 'open-terminal', terminal }),
    terminalEnded: (name, repo) =>
      dispatch({ type: 'terminal-ended', name, repo }),
    undismiss: (keys) => dispatch({ type: 'undismiss', keys }),
  };
}

export function useTabs(): TabsApi {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs must be used within TabsProvider');
  return ctx;
}

/** Repo-scoped api for everything rendered inside a repo workspace: the
 *  same tabs, with `openItem`/`syncItems` bound to the open repo. */
export function useRepoTabs(): RepoTabsApi {
  const { repo } = useRepo();
  const tabs = useTabs();
  const cwd = repo.cwd;
  return useMemo(
    () => ({
      ...tabs,
      openItem: (itemKey: string, opts?: { preview?: boolean }) =>
        tabs.openItem(cwd, itemKey, opts),
      tabOpening: (itemKey: string) => tabOpening(tabs.tabs, cwd, itemKey),
      syncItems: (
        entries: ItemEntry[] | undefined,
        terminals: TerminalEntry[] | undefined,
        foreign: ForeignSessionEntry[] | undefined
      ) => tabs.syncItems(cwd, entries, terminals, foreign),
      close: (id: string) => tabs.close(id, cwd),
      terminalEnded: (name: string) => tabs.terminalEnded(name, cwd),
    }),
    [tabs, cwd]
  );
}

export interface RepoTabsApi
  extends Omit<TabsApi, 'openItem' | 'syncItems' | 'terminalEnded'> {
  openItem: (itemKey: string, opts?: { preview?: boolean }) => void;
  /** The tab a single click on `itemKey` would show. */
  tabOpening: (itemKey: string) => Tab;
  syncItems: (
    entries: ItemEntry[] | undefined,
    terminals: TerminalEntry[] | undefined,
    foreign: ForeignSessionEntry[] | undefined
  ) => void;
  terminalEnded: (name: string) => void;
}
