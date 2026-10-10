import type { TabsState } from './tabs-model.js';

/** Drag-reorder: lift a tab out of the strip and drop it beside another. */
export function moveTab(
  state: TabsState,
  id: string,
  targetId: string,
  side: 'before' | 'after'
): TabsState {
  if (id === targetId) return state;
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from < 0) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  const at = tabs.findIndex((t) => t.id === targetId);
  if (at < 0) return state;
  tabs.splice(side === 'after' ? at + 1 : at, 0, moved);
  return { ...state, tabs };
}
