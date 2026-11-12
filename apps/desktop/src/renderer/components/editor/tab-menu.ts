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

/** A pane's entries on a tab's menu (`use-pane-menus.ts`). */
export interface PaneMenu {
  items(tab: Tab): ContextMenuItem[];
  /** Run a pane entry; false for any other choice. */
  run(chosen: string | null, tab: Tab): boolean;
}

/** What a group offers in its chip's native menu. */
export interface GroupMenu {
  /** Name the group (the rename dialog). */
  rename(): void;
  showTabs(): void;
  /** The supervising layouts (`use-supervise.ts`). */
  canTile: boolean;
  tile(): void;
  canFollow: boolean;
  follow(): void;
}

function groupItems(group: GroupMenu): ContextMenuItem[] {
  return [
    { id: 'group-show', label: 'Show tabs' },
    { id: 'group-rename', label: 'Rename group…' },
    { type: 'separator' },
    { id: 'group-tile', label: 'Tile group', enabled: group.canTile },
    { id: 'group-follow', label: 'Follow group', enabled: group.canFollow },
  ];
}

const GROUP_CHOICES: Record<string, (group: GroupMenu) => void> = {
  'group-show': (g) => g.showTabs(),
  'group-rename': (g) => g.rename(),
  'group-tile': (g) => g.tile(),
  'group-follow': (g) => g.follow(),
};

/** The native menu of a group's chip: the group's actions. Its tabs'
 *  own menus are on their roster rows. */
export async function runGroupMenu(group: GroupMenu): Promise<void> {
  const chosen = await window.n10.showContextMenu(groupItems(group));
  if (chosen && Object.hasOwn(GROUP_CHOICES, chosen))
    GROUP_CHOICES[chosen]!(group);
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

/** The native context menu a tab offers, on the strip or as a roster
 *  row: its own items, its pane's, Rename group for a tab alone in its
 *  place, and what the whole strip does when its tabs overflow. */
function tabMenuItems(
  tab: Tab,
  tabs: ReturnType<typeof useTabs>,
  overflow: TabOverflow,
  rename: (() => void) | undefined,
  panes: PaneMenu | undefined
): ContextMenuItem[] {
  const items = ownItems(tab, tabs);
  if (panes) items.push({ type: 'separator' }, ...panes.items(tab));
  if (rename) items.push({ id: 'group-rename', label: 'Rename group…' });
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
  rename?: () => void,
  panes?: PaneMenu
): Promise<void> {
  const chosen = await window.n10.showContextMenu(
    tabMenuItems(tab, tabs, overflow, rename, panes)
  );
  if (panes?.run(chosen, tab)) return;
  if (chosen === 'group-rename') rename?.();
  else if (runOwnChoice(chosen, tab, tabs, closer)) return;
  else if (chosen && chosen in OVERFLOW) {
    await updateDesktopPrefs({ tabOverflow: OVERFLOW[chosen] });
  }
}
