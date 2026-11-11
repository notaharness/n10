import { useEffect, useMemo, useRef } from 'react';
import type {
  SessionActivitySnapshot,
  SidebarItem,
} from '../../../host/contract.js';
import {
  useForeignSessions,
  useMachines,
  useSessionActivity,
  useSessions,
  useTerminals,
} from '../../lib/data/queries.js';
import {
  hasPeerMachines,
  resolveMachineLabel,
} from '../../lib/machines/machine-model.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  itemBranch,
  itemSessionName,
} from '../../lib/sidebar/sidebar-model.js';
import { useRepoColors } from '../../lib/tabs/repo-colors.js';
import { affiliationIndex, tabFacts } from '../../lib/tabs/tab-affiliation.js';
import {
  groupOf,
  isCollapsed,
  present,
  presentedIds,
  statusFromActivity,
  type TabGroup,
  type TabStatus,
} from '../../lib/tabs/tab-groups.js';
import { indexItems, tabItem } from '../../lib/tabs/tab-item.js';
import { tabRepo } from '../../lib/tabs/tab-presentation.js';
import { notePresentedOrder } from '../../lib/tabs/tab-switching.js';
import { foreignRepoOf, useTabs, type Tab } from '../../lib/tabs/tabs.js';

/** What a tab's button shows, wherever it is drawn: on the strip or as
 *  a roster row. */
export interface TabFace {
  tab: Tab;
  item: SidebarItem | undefined;
  snapshot: SessionActivitySnapshot | undefined;
  foreignRepo: string | null;
  running: boolean;
  machineLabel: string | null;
  repoColor: string | null;
  unseen: boolean;
  /** Its own session's state, for its group's roll-up. */
  status: TabStatus;
}

export interface StripGroups {
  groups: TabGroup[];
  faceOf(tab: Tab): TabFace;
  /** The repository colour a group's chip carries: its home's, else the
   *  one repository every member shares, else none. */
  colorOf(group: TabGroup): string | null;
}

/**
 * The strip's groups and every tab's face, from the open repository's
 * items, the host's session listings and the tabs. Notes the presented
 * order for positional switching, and expands a collapsed group when one
 * of its tabs becomes active from anywhere (the palette, Ctrl+Tab, a
 * roster row).
 */
export function useStripGroups(items: SidebarItem[]): StripGroups {
  const { repo } = useRepo();
  const tabs = useTabs();
  const activity = useSessionActivity(repo.cwd);
  const terminals = useTerminals();
  const foreign = useForeignSessions();
  const sessions = useSessions(repo.cwd);
  const machines = useMachines();
  const repoColors = useRepoColors();
  const showMachines = hasPeerMachines(machines.data ?? []);
  const index = useMemo(() => indexItems(repo.cwd, items), [repo.cwd, items]);

  const sessionRows = useMemo(
    () => items.flatMap((i) => (i.kind === 'session' ? [i.session] : [])),
    [items]
  );
  const affiliations = useMemo(
    () =>
      affiliationIndex({
        repo: repo.cwd,
        sessions: sessionRows,
        terminals: terminals.data ?? [],
        foreign: foreign.data ?? [],
      }),
    [repo.cwd, sessionRows, terminals.data, foreign.data]
  );

  /** The session a tab shows or works beside: a terminal's own, a
   *  worktree row's, else the agent in a checkout on the item's branch. */
  const sessionOf = (tab: Tab): string | undefined => {
    if (tab.kind === 'terminal') return tab.name;
    const item = tabItem(tab, index);
    if (!item) return undefined;
    if (item.kind === 'session') return item.session.name;
    const branch = itemBranch(item);
    for (const i of items) {
      const name = itemSessionName(i);
      if (name && itemBranch(i) === branch) return name;
    }
    return undefined;
  };
  /** Only a tab's own session counts toward its status: a pull request
   *  beside an agent does not copy the agent's. */
  const ownSession = (tab: Tab): string | undefined => {
    if (tab.kind === 'terminal') return tab.name;
    const item = tabItem(tab, index);
    return item?.kind === 'session' ? item.session.name : undefined;
  };

  const machineLabelFor = (tab: Tab): string | null => {
    if (!showMachines) return null;
    const name = sessionOf(tab);
    if (!name) return null;
    const machineId =
      tab.kind === 'terminal'
        ? terminals.data?.find((t) => t.name === name)?.machine
        : sessions.data?.find((s) => s.name === name)?.machine;
    return resolveMachineLabel(machineId, machines.data);
  };
  const colorOfTab = (tab: Tab): string | null => {
    const r = tabRepo(tab);
    return (r && repoColors.get(r)) ?? null;
  };
  const faceOf = (tab: Tab): TabFace => {
    const session = sessionOf(tab);
    const own = ownSession(tab);
    return {
      tab,
      item: tabItem(tab, index),
      snapshot: session ? activity.data?.[session] : undefined,
      foreignRepo: foreignRepoOf(tab, repo.cwd),
      running:
        tab.kind === 'terminal' &&
        (terminals.data ?? []).some((t) => t.name === tab.name && t.running),
      machineLabel: machineLabelFor(tab),
      repoColor: colorOfTab(tab),
      unseen: tabs.unseen.includes(tab.id),
      status: statusFromActivity(own ? activity.data?.[own] : undefined),
    };
  };

  const groups = present(tabs.tabs, (tab) =>
    tabFacts(tab, sessionOf(tab), affiliations)
  );
  const colorOf = (group: TabGroup): string | null => {
    if (group.head) return colorOfTab(group.head);
    const colors = new Set(group.tabs.map(colorOfTab));
    const [only] = colors;
    return colors.size === 1 ? only ?? null : null;
  };

  // Positional keyboard switching walks the order the strip presents,
  // collapsed members included.
  const presented = presentedIds(groups).join('\n');
  useEffect(() => {
    notePresentedOrder(presented ? presented.split('\n') : []);
  }, [presented]);

  // A tab activated from anywhere shows: its group expands. Collapsing
  // the group the active tab is in leaves it collapsed until another
  // activation.
  const active = groupOf(groups, tabs.activeId);
  const activeCollapsed = !!active && isCollapsed(active, tabs.collapsed);
  const activeGroup = active?.key;
  const { activeId, setCollapsed } = tabs;
  const expandedFor = useRef(activeId);
  useEffect(() => {
    // Only a change of the active tab expands; collapsing must not.
    if (expandedFor.current === activeId) return;
    expandedFor.current = activeId;
    if (activeGroup && activeCollapsed) setCollapsed([activeGroup], false);
  }, [activeId, activeGroup, activeCollapsed, setCollapsed]);

  return { groups, faceOf, colorOf };
}
