import type { ContextMenuItem, TabOverflow } from '../../../host/contract.js';
import { updateDesktopPrefs } from '../../lib/desktop-prefs.js';
import { tabPresentation } from '../../lib/tabs/tab-presentation.js';
import type { Tab, useTabs } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import type { PlayerRow } from './OrchestratorPlayers.js';

type Closer = ReturnType<typeof useCloseTabs>;

/** The strip's two answers to more tabs than fit, as menu choices. */
const OVERFLOW: Record<string, TabOverflow> = {
  'overflow-wrap': 'wrap',
  'overflow-scroll': 'scroll',
};

/** Prefix of a player item's id; the rest is its tab's id. */
const PLAYER = 'player:';

/** An orchestrator tab's players, the keyboard's way to the tabs its
 *  hover card lists: a heading, then one item per player tab. Native
 *  menus here have no submenus. */
function playerItems(players: readonly PlayerRow[]): ContextMenuItem[] {
  if (players.length === 0) return [];
  return [
    { type: 'separator' },
    { id: 'players', label: 'Players', enabled: false },
    ...players.map((row) => ({
      id: PLAYER + row.tab.id,
      label: tabPresentation(row.tab, row.item, row.machineLabel).label,
    })),
  ];
}

/** The native context menu a tab offers: closing, keeping a preview,
 *  an orchestrator's players, and what the whole strip does when its
 *  tabs overflow. */
function tabMenuItems(
  tab: Tab,
  tabCount: number,
  overflow: TabOverflow,
  players: readonly PlayerRow[]
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { id: 'close', label: 'Close' },
    { id: 'close-others', label: 'Close Others', enabled: tabCount > 1 },
    { id: 'close-all', label: 'Close All' },
  ];
  if (tab.preview) {
    items.push({ type: 'separator' }, { id: 'pin', label: 'Keep Open' });
  }
  items.push(...playerItems(players));
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
  players: readonly PlayerRow[] = []
): Promise<void> {
  const chosen = await window.n10.showContextMenu(
    tabMenuItems(tab, tabs.tabs.length, overflow, players)
  );
  if (chosen?.startsWith(PLAYER)) tabs.activate(chosen.slice(PLAYER.length));
  else if (chosen === 'close') closer.close(tab.id);
  else if (chosen === 'close-others') closer.closeOthers(tab.id);
  else if (chosen === 'close-all') closer.closeAll();
  else if (chosen === 'pin') tabs.pin(tab.id);
  else if (chosen && chosen in OVERFLOW) {
    await updateDesktopPrefs({ tabOverflow: OVERFLOW[chosen] });
  }
}
