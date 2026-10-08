import { useMemo } from 'react';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  useMachines,
  useOrchestratorGroups,
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
  itemSessionName,
} from '../../lib/sidebar/sidebar-model.js';
import {
  NO_ORCHESTRATOR_TABS,
  orchestratorTabs,
} from '../../lib/tabs/orchestrator-tabs.js';
import { useRepoColors } from '../../lib/tabs/repo-colors.js';
import { indexItems, tabItem } from '../../lib/tabs/tab-item.js';
import { tabRepo } from '../../lib/tabs/tab-presentation.js';
import { foreignRepoOf, useTabs, type Tab } from '../../lib/tabs/tabs.js';
import { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { EditorPane } from './EditorPane.js';
import { EmptyState } from './EmptyState.js';
import { TabButton } from './TabButton.js';
import { TabStrip } from './TabStrip.js';
import { useEditorPanes } from './use-editor-panes.js';

/**
 * Tab strip + the active tab's pane, and at most one spare.
 *
 * A pane is expensive to keep — a diff can hold tens of thousands of
 * nodes and a terminal an xterm instance fed by its session's output —
 * so the editor keeps two at most: the one on screen and one spare,
 * rendered off screen. The spare is the tab the pointer rests on
 * (`usePrewarm`, from a tab or a sidebar row), or else the one on
 * screen before the last switch, whichever repository it belongs to. Switching to the spare is a swap: the
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
  const orchestration = useOrchestratorGroups();
  const showMachines = hasPeerMachines(machines.data ?? []);
  const terminalRunning = useMemo(
    () =>
      new Set(
        (terminals.data ?? []).filter((t) => t.running).map((t) => t.name)
      ),
    [terminals.data]
  );
  const index = useMemo(() => indexItems(repo.cwd, items), [repo.cwd, items]);
  const itemFor = (tab: Tab) => tabItem(tab, index);

  const sessionNameFor = (tab: Tab): string | undefined => {
    // A terminal's session is the tab itself.
    if (tab.kind === 'terminal') return tab.name;
    const item = itemFor(tab);
    if (!item) return undefined;
    // A worktree row is its own session's; its branch may name
    // another checkout's too.
    if (item.kind === 'session') return item.session.name;
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

  // What a tab's button shows, whether it stands in the strip or as a
  // row under its orchestrator's tab.
  const faceOf = (tab: Tab) => {
    const sessionName = sessionNameFor(tab);
    return {
      tab,
      item: itemFor(tab),
      snapshot: sessionName ? activity.data?.[sessionName] : undefined,
      foreignRepo: foreignRepoOf(tab, repo.cwd),
      running: tab.kind === 'terminal' && terminalRunning.has(tab.name),
      machineLabel: machineLabelFor(tab),
    };
  };

  // Orchestra's players stand under their orchestrator's tab.
  const grouping = orchestration.data
    ? orchestratorTabs(tabs.tabs, orchestration.data, sessionNameFor)
    : NO_ORCHESTRATOR_TABS;
  const strip = tabs.tabs.filter((t) => !grouping.grouped.has(t.id));

  // No blanket overlay while a pane mounts: the virtualized diff and
  // the rail each show their own skeletons, and the terminal renders
  // in the first frame.
  const activeInStrip = tabs.activeId
    ? grouping.orchestratorOf.get(tabs.activeId) ?? tabs.activeId
    : null;
  const tabStopId = strip.some((t) => t.id === activeInStrip)
    ? activeInStrip
    : strip[0]?.id;
  const { activePane, paneActiveId, panes } = useEditorPanes(
    tabs.tabs,
    tabs.activeId
  );

  if (tabs.tabs.length === 0) {
    return (
      <EmptyState onOpenPalette={onOpenPalette} hasItems={items.length > 0} />
    );
  }

  const confirmDialog = closer.confirmDialog;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <TabStrip ids={strip.map((t) => t.id)}>
        {strip.map((tab) => {
          const players = grouping.players.get(tab.id)?.map((player) => ({
            ...faceOf(player),
            active: player.id === tabs.activeId,
          }));
          return (
            <TabButton
              key={tab.id}
              {...faceOf(tab)}
              active={tab.id === tabs.activeId}
              closer={closer}
              tabStop={tab.id === tabStopId}
              unseen={tabs.unseen.includes(tab.id)}
              repoColor={colorOf(tab)}
              players={players}
              playerActive={players?.some((p) => p.active) ?? false}
            />
          );
        })}
      </TabStrip>
      <div className="relative min-h-0 flex-1" data-editor-panes>
        {/* Another repository's tab renders against that repository
            (EditorPane), so it can be held ready like any other. */}
        {panes.map((tab) => (
          <EditorPane
            key={tab.id}
            tab={tab}
            items={items}
            index={index}
            shown={tab.id === activePane?.id}
            menuActive={tab.id === activePane?.id && tab.id === tabs.activeId}
            onPin={() => tabs.pin(tab.id)}
          />
        ))}
        {paneActiveId === null && (
          // Tabs on the strip, none of them active.
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
