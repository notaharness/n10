import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import {
  EMPTY_TABS,
  reduce,
  type ForeignSessionEntry,
  type ItemEntry,
  type Tab,
  type TabsState,
  type TerminalEntry,
} from './tabs-model.js';
import { useRepo } from '../repo-context.js';
import { tabOpening } from './tab-identity.js';
import { decodeTabs, encodeTabs } from './tabs-persistence.js';

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
  /** `keep`: tabs spared besides `id` (an orchestrator's players). */
  closeOthers: (id: string, keep?: readonly string[]) => void;
  closeAll: () => void;
  closeActive: () => void;
  /** Drag-reorder: place `id` before/after `targetId`. */
  moveTab: (id: string, targetId: string, side: 'before' | 'after') => void;
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
  resumeTerminal: (previous: string, terminal: TerminalEntry) => void;
  /** The host says the terminal's process ended: close its tab, listed
   *  or not. `repo` is the one in view, for the close-focus rules. */
  terminalEnded: (name: string, repo?: string) => void;
  /** A close's kill failed: forget these auto-open keys (from
   *  `autoOpenKey`/`terminalTabId`) so the session or terminal, still
   *  running, is offered a tab again on the next sync rather than
   *  staying invisible. */
  forgetAutoOpened: (keys: string[]) => void;
}

const TabsContext = createContext<TabsApi | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, EMPTY_TABS);
  const [loaded, setLoaded] = useState(false);
  const saves = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    window.n10.loadOpenTabs().then(
      (saved) => {
        if (!live) return;
        const decoded = decodeTabs(saved);
        if (decoded) dispatch({ type: 'hydrate', saved: decoded });
        setLoaded(true);
      },
      (error: unknown) => {
        if (!live) return;
        toast.error(`Could not load open tabs: ${String(error)}`);
        setLoaded(true);
      }
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const snapshot = encodeTabs(state);
    saves.current = saves.current
      .then(() => window.n10.saveOpenTabs(snapshot))
      .catch((error: unknown) => {
        toast.error(`Could not save open tabs: ${String(error)}`);
      });
  }, [state, loaded]);

  // A removed worktree takes its tabs with it, whoever removed it: n10,
  // `git worktree remove` or `rm -rf`. Heard here, above the repo gate,
  // because the strip spans repositories and the workspace remounts per
  // repository — a scan landing mid-switch would find no listener there.
  useEffect(
    () =>
      window.n10.onDiscoveryChanged(({ repo, removedWorktrees }) => {
        if (removedWorktrees.length === 0) return;
        dispatch({
          type: 'worktrees-removed',
          repo,
          worktrees: removedWorktrees,
        });
      }),
    []
  );

  const openItem = useCallback(
    (repo: string, itemKey: string, opts?: { preview?: boolean }) =>
      dispatch({
        type: 'open-item',
        repo,
        itemKey,
        preview: opts?.preview ?? false,
      }),
    []
  );
  const openSettings = useCallback(
    () => dispatch({ type: 'open-settings' }),
    []
  );
  const pin = useCallback((id: string) => dispatch({ type: 'pin', id }), []);
  const activate = useCallback(
    (id: string) => dispatch({ type: 'activate', id }),
    []
  );
  const close = useCallback(
    (id: string, repo?: string) => dispatch({ type: 'close', id, repo }),
    []
  );
  const closeOthers = useCallback(
    (id: string, keep?: readonly string[]) =>
      dispatch({ type: 'close-others', id, keep }),
    []
  );
  const closeAll = useCallback(() => dispatch({ type: 'close-all' }), []);
  const closeActive = useCallback(() => {
    if (state.activeId) dispatch({ type: 'close', id: state.activeId });
  }, [state.activeId]);
  const moveTab = useCallback(
    (id: string, targetId: string, side: 'before' | 'after') =>
      dispatch({ type: 'move', id, targetId, side }),
    []
  );
  const syncItems = useCallback(
    (
      repo: string,
      entries: ItemEntry[],
      terminals: TerminalEntry[] | undefined,
      foreign: ForeignSessionEntry[] | undefined
    ) => dispatch({ type: 'sync-items', repo, entries, terminals, foreign }),
    []
  );
  const repoOpened = useCallback(
    (repo: string) => dispatch({ type: 'repo-opened', repo }),
    []
  );
  const openTerminal = useCallback(
    (terminal: TerminalEntry) => dispatch({ type: 'open-terminal', terminal }),
    []
  );
  const resumeTerminal = useCallback(
    (previous: string, terminal: TerminalEntry) =>
      dispatch({ type: 'resume-terminal', previous, terminal }),
    []
  );
  const terminalEnded = useCallback(
    (name: string, repo?: string) =>
      dispatch({ type: 'terminal-ended', name, repo }),
    []
  );
  const forgetAutoOpened = useCallback(
    (keys: string[]) => dispatch({ type: 'forget-auto-opened', keys }),
    []
  );

  const api = useMemo<TabsApi>(
    () => ({
      ...state,
      openItem,
      openSettings,
      pin,
      activate,
      close,
      closeOthers,
      closeAll,
      closeActive,
      moveTab,
      syncItems,
      repoOpened,
      openTerminal,
      resumeTerminal,
      terminalEnded,
      forgetAutoOpened,
    }),
    [
      state,
      openItem,
      openSettings,
      pin,
      activate,
      close,
      closeOthers,
      closeAll,
      closeActive,
      moveTab,
      syncItems,
      repoOpened,
      openTerminal,
      resumeTerminal,
      terminalEnded,
      forgetAutoOpened,
    ]
  );

  return (
    <TabsContext.Provider value={api}>
      {loaded && children}
    </TabsContext.Provider>
  );
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
