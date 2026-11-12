import { isForeignTab, tabHome, type Tab } from './tab-identity.js';
import type { Strip } from './workspace.js';
export { presentationOrder } from './tab-label-state.js';

/** Focus a tab in the repository just opened, or its empty state. */
export function focusRepo(state: Strip, repo: string): Strip {
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  if (active && !isForeignTab(active, repo)) return state;
  const remembered = state.tabs.find(
    (tab) => tab.id === state.lastActiveByRepo[repo]
  );
  const own =
    remembered ??
    [...state.tabs].reverse().find((tab) => tabHome(tab) === repo);
  const activeId = own?.id ?? null;
  return activeId === state.activeId ? state : { ...state, activeId };
}

/**
 * What the user does to tabs and groups short of opening and closing
 * them: moving, keeping a preview, pinning and naming. An arrangement
 * (a drop among the strip's blocks or a group's rows) marks the pane
 * `arranged`: its order is the user's now.
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
 *  ignored. The pane is the user's to order from then on. */
export function arrangeTabs(state: Strip, ids: readonly string[]): Strip {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const placed = state.tabs
    .filter((t) => rank.has(t.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const tabs = [...placed, ...state.tabs.filter((t) => !rank.has(t.id))];
  // The stored order may already be the one dropped: the strip showed
  // another, orchestrators first. The drop still makes the order the
  // user's.
  if (tabs.every((t, i) => t === state.tabs[i]))
    return state.arranged ? state : { ...state, arranged: true };
  return { ...state, tabs, arranged: true };
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
