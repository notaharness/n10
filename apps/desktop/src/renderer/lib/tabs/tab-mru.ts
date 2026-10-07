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
 * One press: start a walk if none is under way, then step `delta`
 * through its snapshot, wrapping. Answers the tab to show, or null when
 * there is nowhere to go.
 */
export function stepMru(
  mru: TabMru,
  tabIds: readonly string[],
  activeId: string | null,
  delta: 1 | -1
): { mru: TabMru; target: string | null } {
  const live = new Set(tabIds);
  const base = mru.cycle ?? startCycle(mru.order, tabIds, activeId);
  // A tab closed mid-walk drops out; the walk carries on from the tab
  // it was on.
  const current = base.snapshot[base.index];
  const snapshot = base.snapshot.filter((id) => live.has(id));
  if (snapshot.length < 2) return { mru, target: null };
  const at = current ? Math.max(snapshot.indexOf(current), 0) : 0;
  const index = (at + delta + snapshot.length) % snapshot.length;
  return {
    mru: { order: mru.order, cycle: { snapshot, index } },
    target: snapshot[index] ?? null,
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
