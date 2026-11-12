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
  /** Another group could collapse. */
  canCollapseOthers: boolean;
  showTabs(): void;
  setCollapsed(collapsed: boolean): void;
  collapseOthers(): void;
}

function groupItems(group: GroupMenu): ContextMenuItem[] {
  return [
    { id: 'group-show', label: 'Show tabs' },
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

/** The native context menu a tab offers: closing, keeping a preview,
 *  its group's actions, and what the whole strip does when its tabs
 *  overflow. */
function tabMenuItems(
  tab: Tab,
  tabCount: number,
  overflow: TabOverflow,
  group: GroupMenu | undefined
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { id: 'close', label: 'Close' },
    { id: 'close-others', label: 'Close Others', enabled: tabCount > 1 },
    { id: 'close-all', label: 'Close All' },
  ];
  if (tab.preview) {
    items.push({ type: 'separator' }, { id: 'pin', label: 'Keep Open' });
  }
  if (group) items.push({ type: 'separator' }, ...groupItems(group));
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

export async function runTabMenu(
  tab: Tab,
  tabs: ReturnType<typeof useTabs>,
  closer: Closer,
  overflow: TabOverflow,
  group?: GroupMenu
): Promise<void> {
  const chosen = await window.n10.showContextMenu(
    tabMenuItems(tab, tabs.tabs.length, overflow, group)
  );
  if (runGroupChoice(chosen, group)) return;
  if (chosen === 'close') closer.close(tab.id);
  else if (chosen === 'close-others') closer.closeOthers(tab.id);
  else if (chosen === 'close-all') closer.closeAll();
  else if (chosen === 'pin') tabs.pin(tab.id);
  else if (chosen && chosen in OVERFLOW) {
    await updateDesktopPrefs({ tabOverflow: OVERFLOW[chosen] });
  }
}
