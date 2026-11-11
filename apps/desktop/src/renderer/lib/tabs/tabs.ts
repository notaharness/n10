import { createContext, useContext, useMemo, type Dispatch } from 'react';
import type {
  ForeignSessionEntry,
  ItemEntry,
  Tab,
  TabsAction,
  TabsState,
  TerminalEntry,
} from './tabs-model.js';
import { useRepo } from '../repo-context.js';
import { tabOpening } from './tab-identity.js';

export type {
  ForeignSessionEntry,
  ItemEntry,
  ItemTab,
  Tab,
  TabsAction,
  TabsState,
  TerminalEntry,
  TerminalTab,
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
 */
interface TabsApi extends TabsState {
  openItem: (
    repo: string,
    itemKey: string,
    opts?: { preview?: boolean }
  ) => void;
  openSettings: () => void;
  pin: (id: string) => void;
  activate: (id: string) => void;
  /** `repo` is the one in view: focus never leaves it on a close. */
  close: (id: string, repo?: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  closeActive: () => void;
  /** Drag-reorder: place `ids` (a tab, or a group's tabs) before or
   *  after `targetId`. */
  moveTabs: (
    ids: readonly string[],
    targetId: string,
    side: 'before' | 'after'
  ) => void;
  /** Collapse or expand the groups `keys` name. */
  setCollapsed: (keys: readonly string[], collapsed: boolean) => void;
  /**
   * Reconcile the strip with the current sidebar items *and* the host's
   * terminal listing, in one step: follow re-keyed items, open a tab
   * for each newly running agent, pin any preview tab that now has a
   * live agent behind it, and bring the terminal strip in line with
   * what the host lists — closing the tabs of terminals it no longer
   * has. One dispatch, so both reconciliations land in a single render
   * rather than racing from two effects. No `terminals` is no listing
   * yet, which leaves every terminal tab alone. `foreign` is the
   * host's listing of agents alive in other repositories, each given
   * a tab in its own group once.
   */
  syncItems: (
    repo: string,
    entries: ItemEntry[],
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
  /** A close's kill failed: forget these auto-open keys (from
   *  `autoOpenKey`/`terminalTabId`) so the session or terminal, still
   *  running, is offered a tab again on the next sync rather than
   *  staying invisible. */
  forgetAutoOpened: (keys: string[]) => void;
}

export const TabsContext = createContext<TabsApi | null>(null);

/** The strip's actions over its reducer's `dispatch`: stable for as
 *  long as `dispatch` is. `closeActive` reads the state it is given. */
export function tabsApi(
  state: TabsState,
  dispatch: Dispatch<TabsAction>
): TabsApi {
  return {
    ...state,
    openItem: (repo, itemKey, opts) =>
      dispatch({
        type: 'open-item',
        repo,
        itemKey,
        preview: opts?.preview ?? false,
      }),
    openSettings: () => dispatch({ type: 'open-settings' }),
    pin: (id) => dispatch({ type: 'pin', id }),
    activate: (id) => dispatch({ type: 'activate', id }),
    close: (id, repo) => dispatch({ type: 'close', id, repo }),
    closeOthers: (id) => dispatch({ type: 'close-others', id }),
    closeAll: () => dispatch({ type: 'close-all' }),
    closeActive: () => {
      if (state.activeId) dispatch({ type: 'close', id: state.activeId });
    },
    moveTabs: (ids, targetId, side) =>
      dispatch({ type: 'move', ids, targetId, side }),
    setCollapsed: (keys, collapsed) =>
      dispatch({ type: 'set-collapsed', keys, collapsed }),
    syncItems: (repo, entries, terminals, foreign) =>
      dispatch({ type: 'sync-items', repo, entries, terminals, foreign }),
    repoOpened: (repo) => dispatch({ type: 'repo-opened', repo }),
    openTerminal: (terminal) => dispatch({ type: 'open-terminal', terminal }),
    terminalEnded: (name, repo) =>
      dispatch({ type: 'terminal-ended', name, repo }),
    forgetAutoOpened: (keys) => dispatch({ type: 'forget-auto-opened', keys }),
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
        entries: ItemEntry[],
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
    entries: ItemEntry[],
    terminals: TerminalEntry[] | undefined,
    foreign: ForeignSessionEntry[] | undefined
  ) => void;
  terminalEnded: (name: string) => void;
}
