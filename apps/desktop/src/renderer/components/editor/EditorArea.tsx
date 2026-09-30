import { useDeferredValue, useMemo } from 'react';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  useMachines,
  useSessionActivity,
  useSessions,
  useTerminals,
} from '../../lib/data/queries.js';
import {
  hasPeerMachines,
  resolveMachineLabel,
} from '../../lib/machines/machine-model.js';
import {
  itemBranch,
  itemKey,
  itemSessionName,
  itemWorktree,
} from '../../lib/sidebar/sidebar-model.js';
import { foreignRepoOf, useTabs, type Tab } from '../../lib/tabs/tabs.js';
import { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { BranchSwitchBanner } from './BranchSwitchBanner.js';
import { EmptyState } from './EmptyState.js';
import { SettingsView } from './lazy-panes.js';
import { ItemView } from './ItemView.js';
import { ForeignRepoPane } from './ForeignRepoPane.js';
import { TabButton } from './TabButton.js';
import { TabStrip } from './TabStrip.js';
import { TerminalView } from './TerminalView.js';

/** The pane body for a tab. Each kind renders its own placeholder
 *  while its module lands; nothing here suspends. */
function PaneBody({
  tab,
  item,
  items,
  menuActive,
  onPin,
}: {
  tab: Tab;
  item: SidebarItem | undefined;
  items: SidebarItem[];
  menuActive: boolean;
  onPin: () => void;
}) {
  if (tab.kind === 'settings') return <SettingsView />;
  if (tab.kind === 'terminal') return <TerminalView tab={tab} />;
  return (
    <ItemView
      item={item}
      items={items}
      itemKey={tab.itemKey}
      menuActive={menuActive}
      onPin={onPin}
    />
  );
}

/** The active tab's pane: its branch banner and body. */
function Pane({
  tab,
  item,
  items,
  menuActive,
  onPin,
}: {
  tab: Tab;
  item: SidebarItem | undefined;
  items: SidebarItem[];
  menuActive: boolean;
  onPin: () => void;
}) {
  const switched =
    tab.kind === 'item' &&
    tab.originBranch &&
    item &&
    itemBranch(item) !== tab.originBranch
      ? { current: itemBranch(item), original: tab.originBranch }
      : null;
  return (
    <div className="absolute inset-0 flex min-h-0 flex-col">
      {switched && <BranchSwitchBanner {...switched} />}
      <div className="flex min-h-0 flex-1 flex-col">
        <ErrorBoundary resetKey={tab.id}>
          {/* The pane bodies are code-split (see lazy-panes), but none
              suspends — each renders its own placeholder until its
              module lands, so there is no Suspense boundary here to
              throttle the swap. */}
          <PaneBody
            tab={tab}
            item={item}
            items={items}
            menuActive={menuActive}
            onPin={onPin}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}

/**
 * Tab strip + the active tab's pane. Only the active tab is mounted: a
 * diff pane can hold tens of thousands of nodes and a terminal a wterm
 * instance fed by its session's output, and keeping the background
 * ones alive made every interaction pay for all of them. Switching
 * tabs mounts the new pane from scratch — its terminal from the host's
 * ring buffer (`SessionTerminal`), its review from the query cache.
 */
export function EditorArea({
  items,
  onOpenPalette,
}: {
  items: SidebarItem[];
  onOpenPalette: () => void;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const closer = useCloseTabs(items);
  const activity = useSessionActivity(repo.cwd);
  const terminals = useTerminals();
  const sessions = useSessions(repo.cwd);
  const machines = useMachines();
  const showMachines = hasPeerMachines(machines.data ?? []);
  const terminalRunning = useMemo(
    () =>
      new Set(
        (terminals.data ?? []).filter((t) => t.running).map((t) => t.name)
      ),
    [terminals.data]
  );
  const byKey = useMemo(
    () => new Map(items.map((i) => [itemKey(i), i])),
    [items]
  );
  const byBranch = useMemo(
    () => new Map(items.map((i) => [itemBranch(i), i])),
    [items]
  );
  const byWorktree = useMemo(
    () =>
      new Map(
        items.flatMap((i) => {
          const worktree = itemWorktree(i);
          return worktree ? [[worktree, i] as const] : [];
        })
      ),
    [items]
  );

  /**
   * The sidebar item a tab is showing.
   *
   * Falls back to the tab's stamped branch when its key doesn't resolve:
   * an item re-keys the moment a PR appears (`branch:x` → `pr:42`), and
   * `sync-items` only catches up in an effect — one render happens
   * first. Looking up by key alone would make that render treat the tab
   * as itemless, which swaps the pane out and remounts a live agent's
   * terminal under the user twice over a PR's life. The worktree is asked first,
   * for the same reason: `git switch` inside it moves its item to
   * another key, and can leave its old PR behind under the old one.
   */
  const itemFor = (tab: Tab): SidebarItem | undefined => {
    // A tab from another repository resolves to nothing here on
    // purpose: `items` describes the open repo, and a shared branch
    // name would otherwise hand that tab this repo's worktree, its
    // agent and its diff.
    if (tab.kind !== 'item' || tab.repo !== repo.cwd) return undefined;
    return (
      (tab.worktree ? byWorktree.get(tab.worktree) : undefined) ??
      byKey.get(tab.itemKey) ??
      (tab.branch ? byBranch.get(tab.branch) : undefined)
    );
  };

  const sessionNameFor = (tab: Tab): string | undefined => {
    // A terminal's session is the tab itself.
    if (tab.kind === 'terminal') return tab.name;
    const item = itemFor(tab);
    if (!item) return undefined;
    const branch = itemBranch(item);
    for (const i of items) {
      const name = itemSessionName(i);
      if (name && itemBranch(i) === branch) return name;
    }
    return undefined;
  };

  // The tab title's machine prefix (ux-machines.md §6) — D8-gated on
  // whether a peer is registered at all, on top of resolveMachineLabel
  // already returning null for a local session.
  const machineLabelFor = (tab: Tab): string | null => {
    if (!showMachines) return null;
    const name = sessionNameFor(tab);
    if (!name) return null;
    const machineId =
      tab.kind === 'terminal'
        ? terminals.data?.find((t) => t.name === name)?.machine
        : sessions.data?.find((s) => s.name === name)?.machine;
    return resolveMachineLabel(machineId, machines.data);
  };

  // The tab strip tracks the live state so clicks feel instant; the
  // panes below follow a *deferred* copy, so mounting/unmounting a
  // pane runs as an interruptible background render instead of
  // blocking the click. No blanket overlay: the virtualized diff and
  // the rail each show their own skeletons, and the terminal renders
  // in the first frame.
  const paneTabs = useDeferredValue(tabs.tabs);
  const paneActiveId = useDeferredValue(tabs.activeId);
  const tabStopId = tabs.tabs.some((t) => t.id === tabs.activeId)
    ? tabs.activeId
    : tabs.tabs[0]?.id;

  // The active tab's repository, when it is not the open one. Its pane
  // cannot be rendered from here — every query and every host call is
  // scoped to the open repo — so the notice stands in until the repo
  // switch that activating it kicked off lands.
  const activePane = paneTabs.find((t) => t.id === paneActiveId);
  const foreignCwd = activePane ? foreignRepoOf(activePane, repo.cwd) : null;

  if (tabs.tabs.length === 0) {
    return (
      <EmptyState onOpenPalette={onOpenPalette} hasItems={items.length > 0} />
    );
  }

  const confirmDialog = closer.confirmDialog;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <TabStrip ids={tabs.tabs.map((t) => t.id)} onMove={tabs.moveTab}>
        {tabs.tabs.map((tab) => {
          const sessionName = sessionNameFor(tab);
          return (
            <TabButton
              key={tab.id}
              tab={tab}
              item={itemFor(tab)}
              active={tab.id === tabs.activeId}
              closer={closer}
              snapshot={sessionName ? activity.data?.[sessionName] : undefined}
              foreignRepo={foreignRepoOf(tab, repo.cwd)}
              tabStop={tab.id === tabStopId}
              running={tab.kind === 'terminal' && terminalRunning.has(tab.name)}
              unseen={tabs.unseen.includes(tab.id)}
              machineLabel={machineLabelFor(tab)}
            />
          );
        })}
      </TabStrip>
      <div className="relative min-h-0 flex-1" data-editor-panes>
        {/* A foreign tab has no pane here: its data lives in a
            repository this window is not pointing at. */}
        {activePane && !foreignCwd && (
          <Pane
            key={activePane.id}
            tab={activePane}
            item={itemFor(activePane)}
            items={items}
            menuActive={activePane.id === tabs.activeId}
            onPin={() => tabs.pin(activePane.id)}
          />
        )}
        {foreignCwd && (
          <div className="absolute inset-0 flex min-h-0 flex-col">
            <ForeignRepoPane cwd={foreignCwd} />
          </div>
        )}
        {paneActiveId === null && (
          // Tabs on the strip, but none of them this repository's — it
          // was just opened and has nothing of its own open yet.
          <div className="absolute inset-0 flex min-h-0 flex-col">
            <EmptyState
              onOpenPalette={onOpenPalette}
              hasItems={items.length > 0}
            />
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
