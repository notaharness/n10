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

/** The native context menu a tab offers: closing, keeping a preview,
 *  and what the whole strip does when its tabs overflow. */
function tabMenuItems(
  tab: Tab,
  tabCount: number,
  overflow: TabOverflow
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { id: 'close', label: 'Close' },
    { id: 'close-others', label: 'Close Others', enabled: tabCount > 1 },
    { id: 'close-all', label: 'Close All' },
  ];
  if (tab.preview) {
    items.push({ type: 'separator' }, { id: 'pin', label: 'Keep Open' });
  }
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
  overflow: TabOverflow
): Promise<void> {
  const chosen = await window.n10.showContextMenu(
    tabMenuItems(tab, tabs.tabs.length, overflow)
  );
  if (chosen === 'close') closer.close(tab.id);
  else if (chosen === 'close-others') closer.closeOthers(tab.id);
  else if (chosen === 'close-all') closer.closeAll();
  else if (chosen === 'pin') tabs.pin(tab.id);
  else if (chosen && chosen in OVERFLOW) {
    await updateDesktopPrefs({ tabOverflow: OVERFLOW[chosen] });
  }
}
