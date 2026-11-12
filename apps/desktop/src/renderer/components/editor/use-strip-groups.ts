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
import { listedSessions, tabSessions } from '../../lib/tabs/tab-sessions.js';
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
   *  one repository every member naming one shares, else none. */
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
    () => listedSessions(items, sessions.data),
    [items, sessions.data]
  );
  const affiliations = useMemo(
    () =>
      affiliationIndex({
        repo: repo.cwd,
        sessions: sessionRows,
        terminals: terminals.data ?? [],
        foreign: foreign.data?.sessions ?? [],
      }),
    [repo.cwd, sessionRows, terminals.data, foreign.data]
  );

  const { sessionOf, ownSession } = tabSessions(items, index);

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

  const groups = present(
    tabs.tabs,
    (tab) => tabFacts(tab, sessionOf(tab), affiliations),
    tabs.pinned
  );
  const colorOf = (group: TabGroup): string | null => {
    if (group.head) return colorOfTab(group.head);
    // A terminal in a subdirectory names no repository of its own: it
    // takes no part.
    const colors = new Set(group.tabs.map(colorOfTab).filter(Boolean));
    const [only] = colors;
    return colors.size === 1 ? only ?? null : null;
  };

  // Positional keyboard switching walks the order the strip presents,
  // collapsed members included.
  const presented = presentedIds(groups).join('\n');
  useEffect(() => {
    notePresentedOrder(presented ? presented.split('\n') : []);
  }, [presented]);

  // A tab activated from anywhere shows: its group expands. So does a
  // collapsed group the active tab joins behind its chip (its
  // affiliation came with a later scan, or it was unpinned). Collapsing
  // the active tab's group leaves it collapsed until either changes.
  const active = groupOf(groups, tabs.activeId);
  const activeGroup = active?.key;
  const collapsed = !!active && isCollapsed(active, tabs.collapsed);
  const hidden = collapsed && active.head?.id !== tabs.activeId;
  const { activeId, setCollapsed } = tabs;
  const shownFor = useRef({ id: activeId, group: activeGroup });
  useEffect(() => {
    const before = shownFor.current;
    if (before.id === activeId && before.group === activeGroup) return;
    shownFor.current = { id: activeId, group: activeGroup };
    const expands = before.id !== activeId ? collapsed : hidden;
    if (activeGroup && expands) setCollapsed([activeGroup], false);
  }, [activeId, activeGroup, collapsed, hidden, setCollapsed]);

  return { groups, faceOf, colorOf };
}
