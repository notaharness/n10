import { useEffect, useMemo } from 'react';
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
import {
  present,
  presentedIds,
  statusFromActivity,
  type TabFacts,
  type TabGroup,
  type TabStatus,
} from '../../lib/tabs/tab-groups.js';
import { tabItem } from '../../lib/tabs/tab-item.js';
import {
  tabRepo,
  type tabPresentation,
} from '../../lib/tabs/tab-presentation.js';
import { notePresentedOrder } from '../../lib/tabs/tab-switching.js';
import { foreignRepoOf, useTabs, type Tab } from '../../lib/tabs/tabs.js';
import { canShowTask } from './strip-labels.js';
import { useTabFacts } from './use-tab-facts.js';
import { useStripLabels } from './use-strip-labels.js';

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
 * The strip's groups and every tab's face, from the open repository's
 * items, the host's session listings and the tabs. Notes the presented
 * order for positional switching.
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
        (foreign.data?.sessions ?? []).map((row) => [
          `${row.repo}\0${row.worktree}`,
          row,
        ])
      ),
    [foreign.data]
  );

  const machineLabelFor = (tab: Tab): string | null => {
    const name = sessionOf(tab);
    if (!name) return null;
    const machineId =
      tab.kind === 'terminal'
        ? terminalByName.get(name)?.machine ?? tab.machine
        : sessionByName.get(name)?.machine;
    return !machineId || machineId === 'local'
      ? null
      : tab.kind === 'terminal' &&
        !machines.data?.some((m) => m.peerId === machineId)
      ? tab.machineLabel ?? resolveMachineLabel(machineId, machines.data)
      : resolveMachineLabel(machineId, machines.data);
  };
  const colorOfTab = (tab: Tab): string | null => {
    const r = tabRepo(tab);
    return (r && repoColors.get(r)) ?? null;
  };
  const groups = present(tabs.tabs, factsOf, tabs.pinned);
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
  const branchOf = (tab: Tab): string | undefined =>
    tab.kind === 'terminal' ? terminalByName.get(tab.name)?.branch : undefined;
  const { groupFor, presentationOf, labelOf } = useStripLabels({
    groups,
    tabs,
    index,
    machineLabelFor,
    taskOf,
    branchOf,
  });
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
  // the members behind chips included.
  // Only the focused pane's: the shortcuts walk the pane they act in.
  const presented = presentedIds(groups).join('\n');
  const focused = tabs.focused;
  useEffect(() => {
    if (focused) notePresentedOrder(presented ? presented.split('\n') : []);
  }, [presented, focused]);

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
