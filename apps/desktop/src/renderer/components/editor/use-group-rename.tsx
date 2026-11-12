import { useState, type ReactNode } from 'react';
import {
  groupName,
  groupOf,
  type TabGroup,
} from '../../lib/tabs/tab-groups.js';
import { tabPresentation } from '../../lib/tabs/tab-presentation.js';
import { useTabs } from '../../lib/tabs/tabs.js';
import { RenameGroupDialog, type RenameTarget } from './RenameGroupDialog.js';
import type { TabFace } from './use-strip-groups.js';

export /** What a group is called before the user names it: its home's tab's
 *  label, else its affiliation's. */
function derivedLabel(
  group: TabGroup,
  faceOf: (t: TabGroup['tabs'][number]) => TabFace
): string {
  if (group.head) {
    const face = faceOf(group.head);
    return tabPresentation(face.tab, face.item, face.machineLabel).label;
  }
  if (group.affiliation) return group.affiliation.label;
  const first = group.tabs[0];
  if (!first) return '';
  const face = faceOf(first);
  return tabPresentation(face.tab, face.item, face.machineLabel).label;
}
/**
 * Group names on the strip: what each group is called (the user's
 * name, else its own), and the rename dialog — from a group's menu, a
 * lone tab's menu (the place it would group under), or the palette (the
 * active tab's group). Focus goes back to whatever asked.
 */
export function useGroupRename(
  groups: readonly TabGroup[],
  faceOf: (tab: TabGroup['tabs'][number]) => TabFace
): {
  labelOf(group: TabGroup): string;
  rename(key: string, derived: string): void;
  renameAlone(group: TabGroup): (() => void) | undefined;
  renameActive(): void;
  dialog: ReactNode;
} {
  const tabs = useTabs();
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const rename = (key: string, derived: string) =>
    setRenaming({
      key,
      derived,
      current: tabs.groupNames[key] ?? derived,
      named: Object.hasOwn(tabs.groupNames, key),
      returnFocus:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    });
  const renameAlone = (group: TabGroup) => {
    const a = group.affiliation;
    return a?.kind === 'place' ? () => rename(a.key, a.label) : undefined;
  };
  const renameActive = () => {
    const at = groupOf(groups, tabs.activeId);
    if (!at) return;
    if (at.chipped) return rename(at.key, derivedLabel(at, faceOf));
    const a = at.affiliation;
    if (a) rename(a.key, a.label);
  };
  return {
    labelOf: (group) =>
      groupName(group, tabs.groupNames, derivedLabel(group, faceOf)),
    rename,
    renameAlone,
    renameActive,
    dialog: renaming && (
      <RenameGroupDialog
        target={renaming}
        onRename={tabs.renameGroup}
        onClose={() => setRenaming(null)}
      />
    ),
  };
}
