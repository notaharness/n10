/**
 * Most-recently-used order of the tab strip, for Ctrl+Tab cycling the
 * way editors and browsers do it: the first press snapshots the order
 * and steps one deeper, each further press while the modifier stays
 * held steps on through that snapshot, and letting go commits — the
 * tab landed on becomes the most recent. A quick tap therefore toggles
 * between the two most recent tabs.
 *
 * Pure: the strip's own state is the record of which tabs exist; this
 * only orders their ids.
 */
export interface TabMru {
  /** Tab ids, most recent first. */
  order: readonly string[];
  /** The walk in progress, or null between walks. */
  cycle: { snapshot: readonly string[]; index: number } | null;
}

export const EMPTY_MRU: TabMru = { order: [], cycle: null };

/** `order` restricted to `tabIds`, with tabs it has not seen appended
 *  in strip order (opened but never activated: least recent). */
function reconcile(
  order: readonly string[],
  tabIds: readonly string[]
): string[] {
  const live = new Set(tabIds);
  const kept = order.filter((id) => live.has(id));
  const seen = new Set(kept);
  return [...kept, ...tabIds.filter((id) => !seen.has(id))];
}

function toFront(order: readonly string[], id: string): string[] {
  return [id, ...order.filter((other) => other !== id)];
}

/**
 * The strip changed: tabs opened or closed, or another tab came to the
 * front. Between walks the active tab becomes the most recent; during
 * one the order holds still, since the walk itself is what moves the
 * active tab.
 */
export function noteTabs(
  mru: TabMru,
  tabIds: readonly string[],
  activeId: string | null
): TabMru {
  const order = reconcile(mru.order, tabIds);
  if (mru.cycle) return { ...mru, order };
  return {
    order:
      activeId && tabIds.includes(activeId) ? toFront(order, activeId) : order,
    cycle: null,
  };
}

/** A walk starts from the tab in front, whatever the order says. */
function startCycle(
  order: readonly string[],
  tabIds: readonly string[],
  activeId: string | null
): { snapshot: readonly string[]; index: number } {
  const snapshot = reconcile(order, tabIds);
  return {
    snapshot:
      activeId && snapshot.includes(activeId)
        ? toFront(snapshot, activeId)
        : snapshot,
    index: 0,
  };
}

/**
 * The first live tab `delta` steps on from `index`, walking the
 * snapshot the walk began with, closed tabs included. A tab closed
 * mid-walk — even the one the walk is on — therefore keeps its place:
 * the walk carries on to its live neighbour in the direction pressed,
 * rather than starting over from the front.
 */
function nextLive(
  snapshot: readonly string[],
  index: number,
  delta: 1 | -1,
  live: ReadonlySet<string>
): string | null {
  const n = snapshot.length;
  for (let k = 1; k <= n; k++) {
    const id = snapshot[(((index + k * delta) % n) + n) % n];
    if (id !== undefined && live.has(id)) return id;
  }
  return null;
}

/**
 * One press: start a walk if none is under way, then step `delta`
 * through its snapshot, wrapping. Answers the tab to show, or null when
 * there is nowhere to go. Closed tabs drop out of the snapshot; see
 * `nextLive` for where a walk goes when its own tab is closed.
 */
export function stepMru(
  mru: TabMru,
  tabIds: readonly string[],
  activeId: string | null,
  delta: 1 | -1
): { mru: TabMru; target: string | null } {
  const live = new Set(tabIds);
  const base = mru.cycle ?? startCycle(mru.order, tabIds, activeId);
  const snapshot = base.snapshot.filter((id) => live.has(id));
  if (snapshot.length < 2) return { mru, target: null };
  const target = nextLive(base.snapshot, base.index, delta, live);
  if (target === null) return { mru, target: null };
  return {
    mru: {
      order: mru.order,
      cycle: { snapshot, index: snapshot.indexOf(target) },
    },
    target,
  };
}

/** The modifier was let go: the tab the walk is on becomes the most
 *  recent. No walk, no change. */
export function commitMru(mru: TabMru): TabMru {
  if (!mru.cycle) return mru;
  const landed = mru.cycle.snapshot[mru.cycle.index];
  return {
    order: landed ? toFront(mru.order, landed) : mru.order,
    cycle: null,
  };
}
