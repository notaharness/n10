import type { Affiliation, SessionRef } from '@n10/core/ui';
import type { Tab } from './tab-identity.js';

/**
 * How the strip groups its tabs: by what each belongs to (its
 * affiliation — a reporting parent, else a place), one group per
 * affiliation, in the order of each group's first tab. Pure, over the
 * flat `TabsState.tabs` order: nothing re-sorts that order to keep a
 * group together, and no move is refused. A group shows together
 * wherever its tabs sit; the strip derives contiguity, it never stores it.
 */

/** What the strip knows of a tab to group it. */
export interface TabFacts {
  /** `null` for a tab that belongs to nothing (settings). */
  affiliation: Affiliation | null;
  /** The registry key of the session the tab shows, if any. */
  session?: string;
}

export interface TabGroup {
  /** The affiliation's key, or the tab's own id for a tab that belongs
   *  to nothing. */
  key: string;
  affiliation: Affiliation | null;
  /** A parent group's home's tab when the strip holds it: it heads the
   *  group, as its chip. */
  head: Tab | null;
  /** Every member, the head first, the rest in their strip order. */
  tabs: Tab[];
  /** Shown behind a chip: every parent group, and a place group of more
   *  than one tab. */
  chipped: boolean;
}

/** Whether `tab` is the tab of a parent's home session. */
export function isHomeTab(
  tab: Tab,
  facts: TabFacts,
  home: SessionRef
): boolean {
  if (facts.session !== undefined && facts.session === home.key) return true;
  return (
    tab.kind === 'item' &&
    home.worktree !== '' &&
    tab.repo === home.repo &&
    tab.worktree === home.worktree
  );
}

function headOf(group: Tab[], facts: (tab: Tab) => TabFacts, a: Affiliation) {
  if (a.kind !== 'parent' || !a.home) return null;
  const home = a.home;
  return group.find((tab) => isHomeTab(tab, facts(tab), home)) ?? null;
}

/**
 * Groups whose head reports to another parent come right after that
 * parent's group, in their own first-tab order; groups do not nest, and
 * a cycle of parents is broken at the group whose first tab comes first.
 */
function orderFollowers(groups: TabGroup[]): TabGroup[] {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const parentOf = (g: TabGroup): TabGroup | undefined => {
    const follows =
      g.affiliation?.kind === 'parent' ? g.affiliation.follows : undefined;
    return follows ? byKey.get(follows) : undefined;
  };
  const children = new Map<TabGroup, TabGroup[]>();
  for (const g of groups) {
    const parent = parentOf(g);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), g]);
  }
  const out: TabGroup[] = [];
  const done = new Set<TabGroup>();
  const emit = (g: TabGroup) => {
    if (done.has(g)) return;
    done.add(g);
    out.push(g);
    for (const child of children.get(g) ?? []) emit(child);
  };
  /** The furthest ancestor not yet shown, or `g` itself on a cycle:
   *  a follower waits for it, and comes out right behind it. */
  const topOf = (g: TabGroup): TabGroup => {
    const seen = new Set([g]);
    let at = g;
    for (let up = parentOf(at); up && !done.has(up); up = parentOf(at)) {
      if (seen.has(up)) return g;
      seen.add(up);
      at = up;
    }
    return at;
  };
  for (const g of groups) if (!done.has(g) && topOf(g) === g) emit(g);
  return out;
}

export function present(
  tabs: readonly Tab[],
  facts: (tab: Tab) => TabFacts
): TabGroup[] {
  const members = new Map<
    string,
    { affiliation: Affiliation | null; tabs: Tab[] }
  >();
  for (const tab of tabs) {
    const { affiliation } = facts(tab);
    const key = affiliation?.key ?? `tab:${tab.id}`;
    const group = members.get(key) ?? { affiliation, tabs: [] };
    group.tabs.push(tab);
    members.set(key, group);
  }
  const groups = [...members].map(([key, { affiliation, tabs: list }]) => {
    const head = affiliation ? headOf(list, facts, affiliation) : null;
    return {
      key,
      affiliation,
      head,
      tabs: head ? [head, ...list.filter((t) => t !== head)] : list,
      chipped:
        affiliation?.kind === 'parent' ||
        (affiliation?.kind === 'place' && list.length > 1),
    };
  });
  return orderFollowers(groups);
}

/** Whether a group the user has not collapsed or expanded starts
 *  collapsed, by what it belongs to. */
const STARTS_COLLAPSED: Record<Affiliation['kind'], boolean> = {
  parent: false,
  place: false,
};

export function initiallyCollapsed(affiliation: Affiliation | null): boolean {
  return affiliation !== null && STARTS_COLLAPSED[affiliation.kind];
}

/** Whether `group` shows behind its chip alone, given the user's
 *  choices (`TabsState.collapsed`). Only a chipped group collapses. */
export function isCollapsed(
  group: TabGroup,
  choices: Readonly<Record<string, boolean>>
): boolean {
  return (
    group.chipped &&
    (choices[group.key] ?? initiallyCollapsed(group.affiliation))
  );
}

/** Every tab in the order the strip presents them, collapsed groups
 *  included: what positional switching walks. */
export function presentedIds(groups: readonly TabGroup[]): string[] {
  return groups.flatMap((g) => g.tabs.map((t) => t.id));
}

/** The group `tabId` stands in, if any. */
export function groupOf(
  groups: readonly TabGroup[],
  tabId: string | null
): TabGroup | undefined {
  return tabId === null
    ? undefined
    : groups.find((g) => g.tabs.some((t) => t.id === tabId));
}

/**
 * One primary state per tab, worst first. Only `new-output` (the
 * activity snapshot's `flashing`) and `working` (`active`) have a source
 * today; the explicit states wait for one, and are never inferred from
 * silence, an exit or a pull request's state.
 */
export type TabStatus =
  | 'blocked'
  | 'error'
  | 'done-unseen'
  | 'new-output'
  | 'working'
  | 'idle';

export const STATUS_ORDER: readonly TabStatus[] = [
  'blocked',
  'error',
  'done-unseen',
  'new-output',
  'working',
  'idle',
];

/** A tab's state from its own session's activity snapshot. */
export function statusFromActivity(
  snapshot: { active: boolean; flashing: boolean } | undefined
): TabStatus {
  if (snapshot?.flashing) return 'new-output';
  return snapshot?.active ? 'working' : 'idle';
}

/** How many of `statuses` are in each state, in `STATUS_ORDER`, zeros
 *  left out. */
export function statusCounts(
  statuses: Iterable<TabStatus>
): { status: TabStatus; count: number }[] {
  const counts = new Map<TabStatus, number>();
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1);
  return STATUS_ORDER.flatMap((status) => {
    const count = counts.get(status) ?? 0;
    return count > 0 ? [{ status, count }] : [];
  });
}
