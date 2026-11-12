import type { Tab } from './tab-identity.js';
import type { Strip } from './workspace.js';

/**
 * What the user does to tabs and groups short of opening and closing
 * them: moving, keeping a preview, pinning, collapsing and naming.
 */

/**
 * Place `ids`, in their current relative order, right before or after
 * `targetId`: a tab dragged on its own, or a group's tabs dragged by its
 * chip. Ids no longer on the strip are dropped from the move; a target
 * among the moved ids, or gone, changes nothing.
 */
export function moveTabs(
  state: Strip,
  ids: readonly string[],
  targetId: string,
  side: 'before' | 'after'
): Strip {
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

/** Put the tabs `ids` name first, in that order, and the rest after
 *  them as they were: a block dropped among the strip's blocks, which
 *  the strip hands over as its whole presented order. Unknown ids are
 *  ignored; unchanged state when the order is. */
export function arrangeTabs(state: Strip, ids: readonly string[]): Strip {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const placed = state.tabs
    .filter((t) => rank.has(t.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const tabs = [...placed, ...state.tabs.filter((t) => !rank.has(t.id))];
  if (tabs.every((t, i) => t === state.tabs[i])) return state;
  return { ...state, tabs };
}

/** How many collapse choices are kept. Parent groups are keyed by an
 *  orchestrator run, so their keys keep coming; the oldest choices go. */
export const COLLAPSED_LIMIT = 64;

/** Collapse or expand the groups `keys` name, as the latest choices.
 *  Unchanged state when nothing changes. */
export function setCollapsed(
  state: Strip,
  keys: readonly string[],
  collapsed: boolean
): Strip {
  if (keys.every((key) => state.collapsed[key] === collapsed)) return state;
  const chosen = new Set(keys);
  const kept = Object.entries(state.collapsed).filter(([k]) => !chosen.has(k));
  const next = [...kept, ...keys.map((k) => [k, collapsed] as const)];
  return {
    ...state,
    collapsed: Object.fromEntries(next.slice(-COLLAPSED_LIMIT)),
  };
}

/** End `id`'s preview. Unchanged state when it is no preview. */
export function keepTab(state: Strip, id: string): Strip {
  if (!state.tabs.some((t) => t.id === id && t.preview)) return state;
  const tabs = state.tabs.map(
    (t): Tab =>
      t.id === id && t.kind === 'item' ? { ...t, preview: false } : t
  );
  return { ...state, tabs };
}

/** Pin or unpin the tabs `ids` names that are on the strip. A pin keeps
 *  a preview. Unpinning leaves the tab where it is in the order, so it
 *  shows in its group again where it was. */
export function setPinned(
  state: Strip,
  ids: readonly string[],
  pinned: boolean
): Strip {
  const open = ids.filter((id) => state.tabs.some((t) => t.id === id));
  const was = new Set(state.pinned);
  if (!pinned) {
    const drop = new Set(open);
    const next = state.pinned.filter((id) => !drop.has(id));
    return next.length === state.pinned.length
      ? state
      : { ...state, pinned: next };
  }
  const added = open.filter((id) => !was.has(id));
  if (added.length === 0) return state;
  const kept = added.reduce(keepTab, state);
  return { ...kept, pinned: [...state.pinned, ...added] };
}

/** Name a group; `null` or a blank name drops the name. */
export function renameGroup(
  state: Strip,
  key: string,
  name: string | null
): Strip {
  const trimmed = name?.trim() ?? '';
  if ((state.groupNames[key] ?? '') === trimmed) return state;
  const groupNames = Object.fromEntries(
    Object.entries(state.groupNames).filter(([k]) => k !== key)
  );
  if (trimmed) groupNames[key] = trimmed;
  return { ...state, groupNames };
}
