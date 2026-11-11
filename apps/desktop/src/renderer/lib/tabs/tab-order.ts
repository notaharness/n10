import type { TabsState } from './tabs-model.js';

/**
 * Place `ids`, in their current relative order, right before or after
 * `targetId`: a tab dragged on its own, or a group's tabs dragged by its
 * chip. Ids no longer on the strip are dropped from the move; a target
 * among the moved ids, or gone, changes nothing.
 */
export function moveTabs(
  state: TabsState,
  ids: readonly string[],
  targetId: string,
  side: 'before' | 'after'
): TabsState {
  const moving = new Set(ids);
  if (moving.has(targetId)) return state;
  const moved = state.tabs.filter((t) => moving.has(t.id));
  const rest = state.tabs.filter((t) => !moving.has(t.id));
  const at = rest.findIndex((t) => t.id === targetId);
  if (moved.length === 0 || at < 0) return state;
  const insert = side === 'after' ? at + 1 : at;
  return {
    ...state,
    tabs: [...rest.slice(0, insert), ...moved, ...rest.slice(insert)],
  };
}

/** Collapse or expand the groups `keys` name. Unchanged state when
 *  nothing changes. */
export function setCollapsed(
  state: TabsState,
  keys: readonly string[],
  collapsed: boolean
): TabsState {
  if (keys.every((key) => state.collapsed[key] === collapsed)) return state;
  const next = { ...state.collapsed };
  for (const key of keys) next[key] = collapsed;
  return { ...state, collapsed: next };
}
