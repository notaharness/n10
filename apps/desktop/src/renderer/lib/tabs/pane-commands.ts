import type { DesktopActionId } from '@n10/core/ui';
import type { Edge } from './layout.js';
import type { PanesApi } from './use-panes.js';
import type { PaneId } from './workspace.js';

/**
 * What the keyboard, the palette and the native menus do to the panes,
 * with the word each says when there is nothing to do. Apart from React:
 * the shortcuts run outside any pane (`tab-switching.ts`), and reach the
 * editor through the handler it registers here.
 */

export type PaneDirection = 'left' | 'right' | 'up' | 'down';

export const EDGE_OF: Record<PaneDirection, Edge> = {
  left: 'left',
  right: 'right',
  up: 'top',
  down: 'bottom',
};

const NONE_TOWARD: Record<Edge, string> = {
  left: 'No pane to the left',
  right: 'No pane to the right',
  top: 'No pane above',
  bottom: 'No pane below',
};

export const SPLIT_NEEDS_TABS = 'Open another tab to split this pane';
export const ONE_PANE = 'Only one pane is open';

export type PaneCommand = Extract<DesktopActionId, `desktop.panes.${string}`>;

export function isPaneCommand(id: DesktopActionId): id is PaneCommand {
  return id.startsWith('desktop.panes.');
}

/** The pane a command acts in, and the tab it acts on. */
export interface PaneTarget {
  pane: PaneId;
  /** The pane's tabs, by id. */
  order: readonly string[];
  /** The tab: the pane's active one, or a menu's. */
  tabId: string | null;
}

/** Split `target.pane` toward `edge`, moving its tab into the new half.
 *  Answers the feedback when it cannot. */
export function splitTab(
  panes: PanesApi,
  target: PaneTarget,
  edge: Edge
): string | null {
  if (target.tabId === null || target.order.length < 2) return SPLIT_NEEDS_TABS;
  panes.split([target.tabId], target.pane, edge, target.tabId);
  return null;
}

/** Move `target`'s tab to the pane toward `edge` of its own. */
export function moveTab(
  panes: PanesApi,
  target: PaneTarget,
  edge: Edge,
  toward: (from: PaneId, edge: Edge) => PaneId | null
): string | null {
  const dest = toward(target.pane, edge);
  if (!dest) return NONE_TOWARD[edge];
  if (target.tabId !== null)
    panes.moveToPane([target.tabId], dest, target.tabId);
  return null;
}

export function closePane(panes: PanesApi, pane: PaneId): string | null {
  if (panes.count < 2) return ONE_PANE;
  panes.close(pane);
  return null;
}

/** Run a pane shortcut on the focused pane and its active tab. */
export function runPaneShortcut(
  command: PaneCommand,
  panes: PanesApi,
  target: PaneTarget,
  toward: (from: PaneId, edge: Edge) => PaneId | null
): string | null {
  if (command === 'desktop.panes.split-right') {
    return splitTab(panes, target, 'right');
  }
  if (command === 'desktop.panes.split-down') {
    return splitTab(panes, target, 'bottom');
  }
  if (command === 'desktop.panes.close') return closePane(panes, target.pane);
  const [, verb, dir] =
    /^desktop\.panes\.(focus|move)-(\w+)$/.exec(command) ?? [];
  const edge = EDGE_OF[dir as PaneDirection];
  if (!edge) return null;
  if (verb === 'move') return moveTab(panes, target, edge, toward);
  const dest = toward(target.pane, edge);
  if (!dest) return NONE_TOWARD[edge];
  panes.focus(dest);
  return null;
}

let handler: ((command: PaneCommand) => void) | null = null;

/** The editor's handler for pane shortcuts, while it is mounted. */
export function setPaneCommands(next: ((command: PaneCommand) => void) | null) {
  handler = next;
}

export function hasPaneCommands(): boolean {
  return handler !== null;
}

export function runPaneCommand(command: PaneCommand): boolean {
  if (!handler) return false;
  handler(command);
  return true;
}
