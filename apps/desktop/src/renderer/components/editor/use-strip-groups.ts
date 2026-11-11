import { useCallback, useEffect, useMemo, useRef } from 'react';
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
import { resolveMachineLabel } from '../../lib/machines/machine-model.js';
import { useRepo } from '../../lib/repo-context.js';
import { useRepoColors } from '../../lib/tabs/repo-colors.js';
import { affiliationIndex, tabFacts } from '../../lib/tabs/tab-affiliation.js';
import {
  expandsOnShow,
  groupOf,
  isCollapsed,
  isHomeTab,
  present,
  presentedIds,
  statusFromActivity,
  type TabFacts,
  type TabGroup,
  type TabStatus,
} from '../../lib/tabs/tab-groups.js';
import { indexItems, tabItem } from '../../lib/tabs/tab-item.js';
import { listedSessions, tabSessions } from '../../lib/tabs/tab-sessions.js';
import {
  collisionLabel,
  groupPlacePath,
  placeLabels,
  tabPresentation,
  tabRepo,
} from '../../lib/tabs/tab-presentation.js';
import { notePresentedOrder } from '../../lib/tabs/tab-switching.js';
import { foreignRepoOf, useTabs, type Tab } from '../../lib/tabs/tabs.js';
import { bucketTabs, canShowTask } from './strip-labels.js';

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
  label: string;
  labelParts: { prefix: string; base: string; suffix: string };
  labelKind: ReturnType<typeof tabPresentation>['face'];
  labelSource: ReturnType<typeof tabPresentation>['source'];
  agentTab: boolean;
  taskTitle?: string;
  branch?: string;
  harness?: string;
  chipped: boolean;
}

export interface StripGroups {
  groups: TabGroup[];
  faceOf(tab: Tab): TabFace;
  /** The repository colour a group's chip carries: its home's, else the
   *  one repository every member naming one shares, else none. */
  colorOf(group: TabGroup): string | null;
  /** What the strip groups a tab by (`useTabFacts`). */
  factsOf(tab: Tab): TabFacts;
  /** Which repository's activity `faceOf`'s statuses come from; `null`
   *  while there is no answer for the open one. */
  activitySource: string | null;
}

/**
 * What the strip needs of a tab to group it: the session it shows or
 * works beside, and its affiliation. Also how the workspace places a
 * tab a sync opens (`groupOf`), so it shares one answer with the strip.
 */
export function useTabFacts(items: SidebarItem[]) {
  const { repo } = useRepo();
  const terminals = useTerminals();
  const foreign = useForeignSessions();
  const sessions = useSessions(repo.cwd);
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

  const factsOf = (tab: Tab) => tabFacts(tab, sessionOf(tab), affiliations);
  return { index, sessionOf, ownSession, factsOf };
}

/** Whether `tab` is its parent group's home: the orchestrator's own. */
export function isHomeIn(tab: Tab, facts: TabFacts): boolean {
  const a = facts.affiliation;
  return a?.kind === 'parent' && !!a.home && isHomeTab(tab, facts, a.home);
}

/** The group a tab belongs to as the strip reads it (`useTabFacts`), and
 *  whether it is that group's home, by functions that keep their
 *  identity and read the latest facts: a sync places the tabs it opens
 *  with them without re-running on every render. */
export function useGrouping(items: SidebarItem[]) {
  const { factsOf } = useTabFacts(items);
  const latest = useRef(factsOf);
  useEffect(() => {
    latest.current = factsOf;
  });
  const groupOf = useCallback(
    (tab: Tab) => latest.current(tab).affiliation?.key ?? null,
    []
  );
  const isHome = useCallback(
    (tab: Tab) => isHomeIn(tab, latest.current(tab)),
    []
  );
  return useMemo(() => ({ groupOf, isHome }), [groupOf, isHome]);
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
  const { index, sessionOf, ownSession, factsOf } = useTabFacts(items);
  const terminalByName = useMemo(
    () => new Map((terminals.data ?? []).map((row) => [row.name, row])),
    [terminals.data]
  );
  const sessionByName = useMemo(
    () => new Map((sessions.data ?? []).map((row) => [row.name, row])),
    [sessions.data]
  );
  const foreignByCheckout = useMemo(
    () =>
      new Map(
        (foreign.data?.sessions ?? []).map((row) => [`${row.repo}\0${row.worktree}`, row])
      ),
    [foreign.data]
  );

  const machineLabelFor = (tab: Tab): string | null => {
    const name = sessionOf(tab);
    if (!name) return null;
    const machineId =
      tab.kind === 'terminal'
        ? terminalByName.get(name)?.machine
        : sessionByName.get(name)?.machine;
    return !machineId || machineId === 'local'
      ? null
      : resolveMachineLabel(machineId, machines.data);
  };
  const colorOfTab = (tab: Tab): string | null => {
    const r = tabRepo(tab);
    return (r && repoColors.get(r)) ?? null;
  };
  const groups = present(tabs.tabs, factsOf, tabs.pinned);
  const groupByTab = useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.tabs.map((tab) => [tab.id, group] as const)
        )
      ),
    [groups]
  );
  const groupFor = (tab: Tab) => groupByTab.get(tab.id);
  const placeNames = useMemo(
    () =>
      placeLabels(
        groups.flatMap((group) => {
          const path = groupPlacePath(group);
          return path ? [path] : [];
        })
      ),
    [groups]
  );
  const taskOf = (tab: Tab): string | undefined => {
    if (tab.kind === 'terminal' && tab.terminalKind === 'shell')
      return undefined;
    if (tab.kind === 'terminal') return terminalByName.get(tab.name)?.taskTitle;
    if (tab.kind === 'settings') return undefined;
    const item = tabItem(tab, index);
    if (item?.kind === 'session') return item.session.taskTitle;
    return foreignByCheckout.get(`${tab.repo}\0${tab.worktree}`)?.taskTitle;
  };
  const harnessOf = (tab: Tab): string | undefined => {
    if (tab.kind === 'terminal') return terminalByName.get(tab.name)?.agent;
    if (tab.kind === 'settings') return undefined;
    return (
      sessionByName.get(sessionOf(tab) ?? '')?.agent ??
      foreignByCheckout.get(`${tab.repo}\0${tab.worktree}`)?.agent
    );
  };
  const presentations = new Map<string, ReturnType<typeof tabPresentation>>();
  const presentationOf = (tab: Tab) => {
    const cached = presentations.get(tab.id);
    if (cached) return cached;
    const group = groupFor(tab);
    const presentation = tabPresentation(
      tab,
      tabItem(tab, index),
      machineLabelFor(tab),
      {
        chipped: group?.chipped,
        taskTitle: taskOf(tab),
        place:
          group?.affiliation?.kind === 'place'
            ? placeNames.get(groupPlacePath(group) ?? '')
            : undefined,
        branch:
          tab.kind === 'terminal'
            ? terminalByName.get(tab.name)?.branch
            : undefined,
      }
    );
    presentations.set(tab.id, presentation);
    return presentation;
  };
  const unchipped = 'unchipped';
  const bucketKey = (tab: Tab) =>
    `${
      groupFor(tab)?.chipped ? groupFor(tab)!.key : unchipped
    }\0${presentationOf(tab).label.trim().replace(/\s+/g, ' ').toLowerCase()}`;
  const buckets = bucketTabs(tabs.tabs, bucketKey);
  const collisions = new Map<string, ReturnType<typeof collisionLabel>>();
  const openedIds = tabs.openedIds ?? tabs.tabs.map((tab) => tab.id);
  const labelOf = (tab: Tab) => {
    const cached = collisions.get(tab.id);
    if (cached) return cached;
    const result = collisionLabel(
      tab,
      buckets.get(bucketKey(tab)) ?? [tab],
      (peer) => presentationOf(peer).label,
      openedIds,
      (id) => tabs.collisionOrdinals?.[id],
      (peer) =>
        peer.kind === 'terminal'
          ? terminalByName.get(peer.name)?.branch
          : undefined
    );
    collisions.set(tab.id, result);
    return result;
  };
  const pendingOrdinals = Object.fromEntries(
    tabs.tabs.flatMap((tab) => {
      const base = presentationOf(tab).label;
      const result = labelOf(tab);
      if (!result.ordinal) return [];
      const value = { base, ordinal: result.ordinal };
      const old = tabs.collisionOrdinals?.[tab.id];
      return old?.base === base && old.ordinal === value.ordinal
        ? []
        : [[tab.id, value] as const];
    })
  );
  const pendingKey = JSON.stringify(pendingOrdinals);
  const { assignCollisionOrdinals } = tabs;
  useEffect(() => {
    const values = JSON.parse(pendingKey) as Record<
      string,
      { base: string; ordinal: number }
    >;
    if (Object.keys(values).length) assignCollisionOrdinals(values);
  }, [pendingKey, assignCollisionOrdinals]);
  const faces = new Map<string, TabFace>();
  const faceOf = (tab: Tab): TabFace => {
    const cached = faces.get(tab.id);
    if (cached) return cached;
    const session = sessionOf(tab);
    const own = ownSession(tab);
    const item = tabItem(tab, index);
    const presentation = presentationOf(tab);
    const collision = labelOf(tab);
    const face: TabFace = {
      tab,
      item,
      snapshot: session ? activity.data?.[session] : undefined,
      foreignRepo: foreignRepoOf(tab, repo.cwd),
      running:
        tab.kind === 'terminal' && !!terminalByName.get(tab.name)?.running,
      machineLabel: machineLabelFor(tab),
      repoColor: colorOfTab(tab),
      unseen: tabs.unseen.includes(tab.id),
      status: statusFromActivity(own ? activity.data?.[own] : undefined),
      label: collision.label,
      labelParts: {
        prefix: presentation.prefix,
        base: presentation.base,
        suffix: collision.label.slice(presentation.label.length),
      },
      labelKind: presentation.face,
      labelSource: presentation.source,
      agentTab: canShowTask(tab, item, harnessOf(tab)),
      taskTitle: taskOf(tab),
      branch:
        tab.kind === 'terminal'
          ? terminalByName.get(tab.name)?.branch
          : undefined,
      harness: harnessOf(tab),
      chipped: groupFor(tab)?.chipped ?? false,
    };
    faces.set(tab.id, face);
    return face;
  };
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
  // Only the focused pane's: the shortcuts walk the pane they act in.
  const presented = presentedIds(groups).join('\n');
  const focused = tabs.focused;
  useEffect(() => {
    if (focused) notePresentedOrder(presented ? presented.split('\n') : []);
  }, [presented, focused]);

  // A tab activated from anywhere shows: its group expands
  // (`expandsOnShow`). Only the focused pane's: a follow pane's switch
  // must not reflow the strip the user is in.
  const active = groupOf(groups, tabs.activeId);
  const activeGroup = active?.key;
  const collapsed = !!active && isCollapsed(active, tabs.collapsed);
  const hidden = collapsed && active.head?.id !== tabs.activeId;
  const { activeId, setCollapsed } = tabs;
  const shownFor = useRef({ id: activeId, group: activeGroup });
  useEffect(() => {
    const now = { id: activeId, group: activeGroup };
    const key = expandsOnShow(shownFor.current, now, {
      collapsed,
      hidden,
      focused,
    });
    shownFor.current = now;
    if (key) setCollapsed([key], false);
  }, [activeId, activeGroup, collapsed, hidden, focused, setCollapsed]);

  return {
    groups,
    faceOf,
    colorOf,
    factsOf,
    // The activity answer for the repository open now, when there is
    // one: a placeholder carried over from another is none.
    activitySource:
      activity.data !== undefined && !activity.isPlaceholderData
        ? repo.cwd
        : null,
  };
}
