import { useEffect, useMemo } from 'react';
import type { TabGroup } from '../../lib/tabs/tab-groups.js';
import { tabItem } from '../../lib/tabs/tab-item.js';
import {
  collisionLabel,
  groupPlacePath,
  placeLabels,
  tabPresentation,
} from '../../lib/tabs/tab-presentation.js';
import type { Tab } from '../../lib/tabs/tabs.js';
import type { useTabs } from '../../lib/tabs/tabs.js';
import { bucketTabs } from './strip-labels.js';

type Tabs = ReturnType<typeof useTabs>;
type ItemIndex = Parameters<typeof tabItem>[1];

/** Whole labels and collision numbers for one pane's presented strip. */
export function useStripLabels({
  groups,
  tabs,
  index,
  machineLabelFor,
  taskOf,
  branchOf,
}: {
  groups: TabGroup[];
  tabs: Tabs;
  index: ItemIndex;
  machineLabelFor: (tab: Tab) => string | null;
  taskOf: (tab: Tab) => string | undefined;
  branchOf: (tab: Tab) => string | undefined;
}) {
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
        branch: branchOf(tab),
      }
    );
    presentations.set(tab.id, presentation);
    return presentation;
  };
  const bucketKey = (tab: Tab) =>
    `${
      groupFor(tab)?.chipped ? groupFor(tab)!.key : 'unchipped'
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
      branchOf
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

  return { groupFor, presentationOf, labelOf };
}
