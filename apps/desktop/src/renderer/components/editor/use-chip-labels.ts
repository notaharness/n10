import { useEffect } from 'react';
import { harnessLabel } from '@n10/core/ui';
import { chipLabels } from '../../lib/tabs/chip-labels.js';
import type { TabGroup } from '../../lib/tabs/tab-groups.js';
import {
  groupPlacePath,
  placeLabels,
  placeName,
} from '../../lib/tabs/tab-presentation.js';
import { useTabs } from '../../lib/tabs/tabs.js';
import { derivedLabel } from './use-group-rename.js';
import type { TabFace } from './use-strip-groups.js';

function groupLabel(
  group: TabGroup,
  faceOf: (tab: TabGroup['tabs'][number]) => TabFace,
  places: ReadonlyMap<string, string>,
  previous?: string
): string {
  const affiliation = group.affiliation;
  if (!affiliation) return '';
  if (previous && !group.head && affiliation.kind === 'parent') return previous;
  const path = groupPlacePath(group);
  const place = path ? places.get(path) ?? placeName(path) : 'Multiple places';
  const harness = harnessLabel(affiliation.key);
  const base =
    affiliation.kind === 'place'
      ? place
      : [harness, place].filter(Boolean).join(' · ');
  const machines = group.head
    ? [faceOf(group.head).machineLabel]
    : group.tabs.map((tab) => faceOf(tab).machineLabel);
  const machine = new Set(machines).size === 1 ? machines[0] : null;
  return machine ? `${machine} · ${base}` : base;
}

/** Derived chip names and ordinals scoped to this pane's strip. */
export function useChipLabels(
  groups: readonly TabGroup[],
  faceOf: (tab: TabGroup['tabs'][number]) => TabFace
): (group: TabGroup) => string {
  const tabs = useTabs();
  const places = placeLabels(
    groups.flatMap((group) => {
      const path = groupPlacePath(group);
      return path ? [path] : [];
    })
  );
  const ordered = groups
    .filter((group) => group.chipped)
    .sort((a, b) => {
      const first = (group: TabGroup) =>
        Math.min(
          ...group.tabs.map((tab) => (tabs.openedIds ?? []).indexOf(tab.id))
        );
      return first(a) - first(b);
    });
  const { labels, ordinals } = chipLabels(
    ordered.map((group) => ({
      key: group.key,
      base: groupLabel(
        group,
        faceOf,
        places,
        tabs.chipOrdinals?.[group.key]?.home
          ? tabs.chipOrdinals[group.key]?.label
          : undefined
      ),
      home: Boolean(group.head),
    })),
    tabs.chipOrdinals
  );
  const key = JSON.stringify(ordinals);
  const held = JSON.stringify(tabs.chipOrdinals ?? {});
  const { assignChipOrdinals } = tabs;
  useEffect(() => {
    if (key !== held) assignChipOrdinals(JSON.parse(key) as typeof ordinals);
  }, [key, held, assignChipOrdinals]);
  return (group) => labels.get(group.key) ?? derivedLabel(group, faceOf);
}
