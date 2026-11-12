import type { PaneLabels, Strip, Workspace } from './workspace.js';
import { panesOf } from './workspace.js';

export type LabelAction =
  | {
      type: 'assign-collision-ordinals';
      values: Readonly<Record<string, { base: string; ordinal: number }>>;
    }
  | {
      type: 'assign-chip-ordinals';
      values: Readonly<
        Record<string, { label: string; ordinal: number; home?: boolean }>
      >;
    };

/** Label numbers belong to the pane's strip and are never saved. */
export function assignOrdinals(state: Strip, action: LabelAction): Strip {
  return action.type === 'assign-collision-ordinals'
    ? {
        ...state,
        collisionOrdinals: { ...state.collisionOrdinals, ...action.values },
      }
    : { ...state, chipOrdinals: action.values };
}

/** Keep a tab's number while it remains in this pane. */
export function presentationOrder(previous: Strip, next: Strip): Strip {
  if (next === previous) return previous;
  const open = new Set(next.tabs.map((tab) => tab.id));
  const ordered = (previous.openedIds ?? []).filter((id) => open.has(id));
  for (const tab of next.tabs)
    if (!ordered.includes(tab.id)) ordered.push(tab.id);
  const collisionOrdinals = Object.fromEntries(
    Object.entries(next.collisionOrdinals ?? {}).filter(([id]) => open.has(id))
  );
  return { ...next, openedIds: ordered, collisionOrdinals };
}

/** A reconciliation keeps each pane's opening order, then notes tabs it placed there. */
export function reconciledPaneLabels(
  previous: PaneLabels | undefined,
  ids: readonly string[]
): PaneLabels {
  const open = new Set(ids);
  const openedIds = (previous?.openedIds ?? []).filter((id) => open.has(id));
  for (const id of ids) if (!openedIds.includes(id)) openedIds.push(id);
  return {
    openedIds,
    collisionOrdinals: Object.fromEntries(
      Object.entries(previous?.collisionOrdinals ?? {}).filter(([id]) =>
        open.has(id)
      )
    ),
    chipOrdinals: previous?.chipOrdinals ?? {},
  };
}

/** A pane move or close bypasses the strip reducer; drop its old allocations. */
export function prunePaneLabels(ws: Workspace): Workspace {
  const panes = panesOf(ws.layout);
  const labels = Object.fromEntries(
    panes.flatMap((pane) => {
      const state = ws.labelState[pane.id];
      if (!state) return [];
      const open = new Set(pane.order);
      return [
        [
          pane.id,
          {
            ...state,
            openedIds: state.openedIds.filter((id) => open.has(id)),
            collisionOrdinals: Object.fromEntries(
              Object.entries(state.collisionOrdinals).filter(([id]) =>
                open.has(id)
              )
            ),
          },
        ],
      ];
    })
  );
  return { ...ws, labelState: labels };
}
