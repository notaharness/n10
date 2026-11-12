import type { ContextMenuItem, TabOverflow } from '../../../host/contract.js';
import { updateDesktopPrefs } from '../../lib/desktop-prefs.js';
import type { Tab, useTabs } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';

type Closer = ReturnType<typeof useCloseTabs>;

/** The strip's two answers to more tabs than fit, as menu choices. */
const OVERFLOW: Record<string, TabOverflow> = {
  'overflow-wrap': 'wrap',
  'overflow-scroll': 'scroll',
};

/** What a group offers in a native menu: its chip's, and below a
 *  member's own items. */
export interface GroupMenu {
  collapsed: boolean;
  /** Name the group (the rename dialog). */
  rename(): void;
  /** Another group could collapse. */
  canCollapseOthers: boolean;
  showTabs(): void;
  setCollapsed(collapsed: boolean): void;
  collapseOthers(): void;
}

function groupItems(group: GroupMenu): ContextMenuItem[] {
  return [
    { id: 'group-show', label: 'Show tabs' },
    { id: 'group-rename', label: 'Rename group…' },
    group.collapsed
      ? { id: 'group-expand', label: 'Expand group' }
      : { id: 'group-collapse', label: 'Collapse group' },
    {
      id: 'group-collapse-others',
      label: 'Collapse others',
      enabled: group.canCollapseOthers,
    },
  ];
}

/** Run a group's own choice; false for any other. */
function runGroupChoice(chosen: string | null, group?: GroupMenu): boolean {
  if (!group) return false;
  if (chosen === 'group-show') group.showTabs();
  else if (chosen === 'group-rename') group.rename();
  else if (chosen === 'group-expand') group.setCollapsed(false);
  else if (chosen === 'group-collapse') group.setCollapsed(true);
  else if (chosen === 'group-collapse-others') group.collapseOthers();
  else return false;
  return true;
}

/** The native menu of a chip with no tab of its own (a stand-in, a
 *  place): the group's actions alone. */
export async function runGroupMenu(group: GroupMenu): Promise<void> {
  runGroupChoice(await window.n10.showContextMenu(groupItems(group)), group);
}

const PINS_STAY = 'Pinned tabs stay open';

/** A tab's own items: closing, pinning and keeping a preview. Close
 *  Others and Close All leave pinned tabs, and are off when nothing
 *  else would close. */
function ownItems(
  tab: Tab,
  tabs: ReturnType<typeof useTabs>
): ContextMenuItem[] {
  const pinned = new Set(tabs.pinned);
  const unpinned = tabs.tabs.filter((t) => !pinned.has(t.id));
  const others = unpinned.some((t) => t.id !== tab.id);
  const items: ContextMenuItem[] = [
    { id: 'close', label: 'Close' },
    {
      id: 'close-others',
      label: 'Close Others',
      enabled: others,
      toolTip: PINS_STAY,
    },
    {
      id: 'close-all',
      label: 'Close All',
      enabled: unpinned.length > 0,
      toolTip: PINS_STAY,
    },
    { type: 'separator' },
    pinned.has(tab.id)
      ? { id: 'unpin', label: 'Unpin tab' }
      : { id: 'pin', label: 'Pin tab' },
  ];
  if (tab.preview) items.push({ id: 'keep', label: 'Keep Open' });
  return items;
}

/** The native context menu a tab offers: its own items, its group's
 *  actions — or, for a tab alone in its place, Rename group — and what
 *  the whole strip does when its tabs overflow. */
function tabMenuItems(
  tab: Tab,
  tabs: ReturnType<typeof useTabs>,
  overflow: TabOverflow,
  group: GroupMenu | undefined,
  rename: (() => void) | undefined
): ContextMenuItem[] {
  const items = ownItems(tab, tabs);
  if (group) items.push({ type: 'separator' }, ...groupItems(group));
  else if (rename) items.push({ id: 'group-rename', label: 'Rename group…' });
  items.push(
    { type: 'separator' },
    {
      id: 'overflow-wrap',
      label: 'Wrap Tabs onto More Rows',
      checked: overflow === 'wrap',
    },
    {
      id: 'overflow-scroll',
      label: 'Scroll Tabs in One Row',
      checked: overflow === 'scroll',
    }
  );
  return items;
}

/** Run a tab's own choice; false for any other. */
function runOwnChoice(
  chosen: string | null,
  tab: Tab,
  tabs: ReturnType<typeof useTabs>,
  closer: Closer
): boolean {
  if (chosen === 'close') closer.close(tab.id);
  else if (chosen === 'close-others') closer.closeOthers(tab.id);
  else if (chosen === 'close-all') closer.closeAll();
  else if (chosen === 'keep') tabs.keep(tab.id);
  else if (chosen === 'pin' || chosen === 'unpin')
    tabs.setPinned([tab.id], chosen === 'pin');
  else return false;
  return true;
}

export async function runTabMenu(
  tab: Tab,
  tabs: ReturnType<typeof useTabs>,
  closer: Closer,
  overflow: TabOverflow,
  group?: GroupMenu,
  rename?: () => void
): Promise<void> {
  const chosen = await window.n10.showContextMenu(
    tabMenuItems(tab, tabs, overflow, group, rename)
  );
  if (runGroupChoice(chosen, group)) return;
  if (chosen === 'group-rename') rename?.();
  else if (runOwnChoice(chosen, tab, tabs, closer)) return;
  else if (chosen && chosen in OVERFLOW) {
    await updateDesktopPrefs({ tabOverflow: OVERFLOW[chosen] });
  }
}
