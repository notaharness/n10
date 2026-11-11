import { useMemo } from 'react';
import { paneToward, panesOf, type Edge } from './layout.js';
import { useWorkspace } from './tabs.js';
import type { LayoutNode, PaneId } from './workspace.js';
import { paneOf } from './workspace.js';

/** The editor's panes and what the user does to them, apart from any
 *  one pane's strip (`useTabs`). */
export interface PanesApi {
  layout: LayoutNode;
  focusedPane: PaneId;
  count: number;
  /** The pane holding tab `id`, if any. */
  paneOf(id: string): PaneId | undefined;
  /** The pane toward `edge` of `from`, if any. */
  toward(from: PaneId, edge: Edge): PaneId | null;
  focus(pane: PaneId): void;
  split(
    ids: readonly string[],
    target: PaneId,
    edge: Edge,
    activate?: string
  ): void;
  moveToPane(ids: readonly string[], pane: PaneId, activate?: string): void;
  close(pane: PaneId): void;
  focusToward(edge: Edge): void;
  moveToward(edge: Edge): void;
  resize(key: string, sizes: readonly number[]): void;
}

export function usePanes(): PanesApi {
  const { workspace: ws, dispatch } = useWorkspace();
  return useMemo(
    () => ({
      layout: ws.layout,
      focusedPane: ws.focusedPane,
      count: panesOf(ws.layout).length,
      paneOf: (id) => paneOf(ws, id)?.id,
      toward: (from, edge) => paneToward(ws.layout, from, edge),
      focus: (pane) => dispatch({ type: 'focus-pane', pane }),
      split: (ids, target, edge, activate) =>
        dispatch({ type: 'split', ids, target, edge, activate }),
      moveToPane: (ids, pane, activate) =>
        dispatch({ type: 'move-to-pane', ids, pane, activate }),
      close: (pane) => dispatch({ type: 'close-pane', pane }),
      focusToward: (edge) => dispatch({ type: 'focus-toward', edge }),
      moveToward: (edge) => dispatch({ type: 'move-toward', edge }),
      resize: (key, sizes) => dispatch({ type: 'resize-split', key, sizes }),
    }),
    [ws, dispatch]
  );
}
