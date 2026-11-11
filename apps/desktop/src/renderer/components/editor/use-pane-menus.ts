import { toast } from 'sonner';
import type { ContextMenuItem } from '../../../host/contract.js';
import {
  closePane,
  EDGE_OF,
  moveTab,
  roomToSplit,
  splitTab,
  type PaneDirection,
  type PaneTarget,
} from '../../lib/tabs/pane-commands.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import { usePanes } from '../../lib/tabs/use-panes.js';
import { errorMessage } from '../../lib/utils.js';
import { paneFrame, revealFocusedPane } from './reveal-tab.js';
import type { PaneMenu } from './tab-menu.js';

/** A pane command's outcome: what it says when it has nothing to do,
 *  else focus to the focused pane, its active tab revealed. */
export function sayPane(message: string | null): void {
  if (message) toast(message, { id: 'pane-feedback', duration: 2000 });
  else revealFocusedPane();
}

const DIRECTIONS: readonly { dir: PaneDirection; label: string }[] = [
  { dir: 'left', label: 'Left' },
  { dir: 'right', label: 'Right' },
  { dir: 'up', label: 'Up' },
  { dir: 'down', label: 'Down' },
];

const CLOSE_PANE_TIP = 'Move tabs to a neighboring pane';

/**
 * A pane's entries in the native menus: on a tab, splitting the pane by
 * moving that tab into a new half, and moving it to the pane on a side;
 * on the strip's blank room, the same for the active tab, and closing
 * the pane. Splitting needs another tab to stay behind, and moving a
 * pane that way: the entries are off where they would do nothing.
 */
export function usePaneMenus() {
  const panes = usePanes();
  const tabs = useTabs();
  const target = (tabId: string | null): PaneTarget => ({
    pane: tabs.paneId,
    order: tabs.tabs.map((t) => t.id),
    tabId,
    frame: paneFrame(tabs.paneId),
  });
  const items = (tabId: string | null): ContextMenuItem[] => {
    const at = target(tabId);
    const splits = tabId !== null && tabs.tabs.length > 1;
    const ways = DIRECTIONS.map(({ dir, label }) => ({
      id: `pane-move-${dir}`,
      label,
      enabled: panes.toward(tabs.paneId, EDGE_OF[dir]) !== null,
    }));
    return [
      {
        id: 'pane-split-right',
        label: 'Split right',
        enabled: splits && roomToSplit(at, 'right'),
      },
      {
        id: 'pane-split-down',
        label: 'Split down',
        enabled: splits && roomToSplit(at, 'bottom'),
      },
      {
        id: 'pane-move',
        label: 'Move tab',
        enabled: tabId !== null && ways.some((w) => w.enabled),
        submenu: ways,
      },
    ];
  };
  const run = (chosen: string | null, tabId: string | null): boolean => {
    const at = target(tabId);
    if (chosen === 'pane-split-right') sayPane(splitTab(panes, at, 'right'));
    else if (chosen === 'pane-split-down')
      sayPane(splitTab(panes, at, 'bottom'));
    else if (chosen === 'pane-close') sayPane(closePane(panes, tabs.paneId));
    else if (chosen?.startsWith('pane-move-')) {
      const dir = chosen.slice('pane-move-'.length) as PaneDirection;
      sayPane(moveTab(panes, at, EDGE_OF[dir], panes.toward));
    } else return false;
    return true;
  };
  const tabMenu: PaneMenu = {
    items: (tab: Tab) => items(tab.id),
    run: (chosen, tab) => run(chosen, tab.id),
  };
  const stripMenu = () => {
    const menu: ContextMenuItem[] = [
      ...items(tabs.activeId),
      { type: 'separator' },
      {
        id: 'pane-close',
        label: 'Close pane',
        enabled: panes.count > 1,
        toolTip: CLOSE_PANE_TIP,
      },
    ];
    window.n10
      .showContextMenu(menu)
      .then((chosen) => run(chosen, tabs.activeId))
      .catch((err: unknown) => toast.error(errorMessage(err)));
  };
  return { tabMenu, stripMenu };
}
