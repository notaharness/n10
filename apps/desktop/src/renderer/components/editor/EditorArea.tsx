import { useMemo } from 'react';
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
import { PaneShownContext } from '../../lib/tabs/pane-shown.js';
import { useRepoColors } from '../../lib/tabs/repo-colors.js';
import { tabRepo } from '../../lib/tabs/tab-presentation.js';
import { TabViewScope } from '../../lib/tabs/tab-views.js';
import { foreignRepoOf, useTabs, type Tab } from '../../lib/tabs/tabs.js';
import { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { cn } from '../../lib/utils.js';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { BranchSwitchBanner } from './BranchSwitchBanner.js';
import { EmptyState } from './EmptyState.js';
import { SettingsView } from './lazy-panes.js';
import { ItemView } from './ItemView.js';
import { ForeignRepoPane } from './ForeignRepoPane.js';
import { TabButton } from './TabButton.js';
import { TabStrip } from './TabStrip.js';
import { TerminalView } from './TerminalView.js';
import { useEditorPanes } from './use-editor-panes.js';

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

/** A tab's pane: its branch banner and body. The spare is rendered
 *  off screen and `inert`, so nothing in it takes focus or events. */
function Pane({
  tab,
  item,
  items,
  shown,
  menuActive,
  onPin,
}: {
  tab: Tab;
  item: SidebarItem | undefined;
  items: SidebarItem[];
  shown: boolean;
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
    <div
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col',
        !shown && 'invisible'
      )}
      inert={!shown}
      aria-hidden={!shown || undefined}
      data-spare-pane={!shown || undefined}
    >
      <TabViewScope value={tab.id}>
        <PaneShownContext.Provider value={shown}>
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
        </PaneShownContext.Provider>
      </TabViewScope>
    </div>
  );
}

/**
 * Tab strip + the active tab's pane, and at most one spare.
 *
 * A pane is expensive to keep — a diff can hold tens of thousands of
 * nodes and a terminal a wterm instance fed by its session's output —
 * so the editor keeps two at most: the one on screen and one spare,
 * rendered off screen. The spare is the tab the pointer rests on
 * (`usePrewarm`, from a tab or a sidebar row), or else the one on
 * screen before the last switch. Switching to the spare is a swap: the
 * panes are keyed by tab id, so the same pane is shown, not a new one
 * mounted, and the pane it replaces becomes the spare. Switching to
 * anything else mounts that tab from scratch — its terminal from the
 * host's ring buffer (`SessionTerminal`), its review from the query
 * cache — and a hover in progress is dropped for it.
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

  // Each repository's colour; a tab with no repository has none.
  const repoColors = useRepoColors();
  const colorOf = (tab: Tab): string | null => {
    const r = tabRepo(tab);
    return (r && repoColors.get(r)) ?? null;
  };

  // No blanket overlay while a pane mounts: the virtualized diff and
  // the rail each show their own skeletons, and the terminal renders
  // in the first frame.
  const tabStopId = tabs.tabs.some((t) => t.id === tabs.activeId)
    ? tabs.activeId
    : tabs.tabs[0]?.id;
  const { activePane, paneActiveId, foreignCwd, panes } = useEditorPanes(
    tabs.tabs,
    tabs.activeId,
    repo.cwd
  );

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
              repoColor={colorOf(tab)}
            />
          );
        })}
      </TabStrip>
      <div className="relative min-h-0 flex-1" data-editor-panes>
        {/* A foreign tab has no pane here: its data lives in a
            repository this window is not pointing at. */}
        {panes.map((tab) => (
          <Pane
            key={tab.id}
            tab={tab}
            item={itemFor(tab)}
            items={items}
            shown={tab.id === activePane?.id}
            menuActive={tab.id === activePane?.id && tab.id === tabs.activeId}
            onPin={() => tabs.pin(tab.id)}
          />
        ))}
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
