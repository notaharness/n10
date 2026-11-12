import type { Affiliation, SessionRef } from '@n10/core/ui';
import type { Tab } from './tab-identity.js';

/**
 * How the strip groups its tabs: by what each belongs to (its
 * affiliation — a reporting parent, else a place), one group per
 * affiliation, in the order of each group's first tab. Pure, over the
 * flat order of a pane's tabs: nothing re-sorts that order to keep a
 * group together, and no move is refused. A group shows together
 * wherever its tabs sit; the strip derives contiguity, it never stores it.
 * Pinned tabs come first, each standing alone outside its group.
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
  /** On a group shown right after the parent group its home reports to
   *  (`Affiliation.follows`): that group's key. It moves with it. */
  behind?: string;
  /** A pinned tab standing alone at the pane's start. Its group counts
   *  it no longer. */
  pinned?: true;
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
 * parent's group, in their own first-tab order; groups do not nest. A
 * cycle of parents is broken at its member that comes first.
 */
function orderFollowers(groups: TabGroup[]): TabGroup[] {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const rank = new Map(groups.map((g, i) => [g, i]));
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
  const emit = (g: TabGroup, behind?: string) => {
    if (done.has(g)) return;
    done.add(g);
    out.push(behind ? { ...g, behind } : g);
    for (const child of children.get(g) ?? []) emit(child, g.key);
  };
  /** The furthest ancestor of `g`: a follower waits for it, and comes
   *  out behind it. On a cycle, the cycle's member that comes first. */
  const topOf = (g: TabGroup): TabGroup => {
    const path = [g];
    for (let up = parentOf(g); up; up = parentOf(up)) {
      const at = path.indexOf(up);
      if (at >= 0) return firstOf(path.slice(at), rank);
      path.push(up);
    }
    return path[path.length - 1]!;
  };
  for (const g of groups) if (topOf(g) === g) emit(g);
  return out;
}

function firstOf(
  cycle: readonly TabGroup[],
  rank: ReadonlyMap<TabGroup, number>
): TabGroup {
  return cycle.reduce((a, b) => (rank.get(b)! < rank.get(a)! ? b : a));
}

/** A pinned tab as the strip shows it: on its own, before every group. */
function pinnedGroup(tab: Tab, facts: (tab: Tab) => TabFacts): TabGroup {
  return {
    key: `pin:${tab.id}`,
    affiliation: facts(tab).affiliation,
    head: null,
    tabs: [tab],
    chipped: false,
    pinned: true,
  };
}

export function present(
  tabs: readonly Tab[],
  facts: (tab: Tab) => TabFacts,
  pinned: readonly string[] = []
): TabGroup[] {
  const pins = new Set(pinned);
  const members = new Map<
    string,
    { affiliation: Affiliation | null; tabs: Tab[] }
  >();
  for (const tab of tabs) {
    if (pins.has(tab.id)) continue;
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
  const pinnedFirst = tabs
    .filter((t) => pins.has(t.id))
    .map((t) => pinnedGroup(t, facts));
  return [...pinnedFirst, ...orderFollowers(groups)];
}

/** What a group is called: the user's name for it, else `derived`. */
export function groupName(
  group: TabGroup,
  names: Readonly<Record<string, string>>,
  derived: string
): string {
  return names[group.key] ?? derived;
}

/** Whether a group the user has not collapsed or expanded starts
 *  collapsed, by what it belongs to. */
const STARTS_COLLAPSED: Record<Affiliation['kind'], boolean> = {
  // Players wait behind their parent's chip until asked for.
  parent: true,
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

/** The row's one Tab stop: the active tab when it shows, else the
 *  shown tab nearest it in strip order (behind a collapsed chip, its
 *  home or a neighbour), else the first. */
export function tabStopOf(
  presented: readonly string[],
  shown: readonly string[],
  activeId: string | null
): string | undefined {
  const at = activeId === null ? -1 : presented.indexOf(activeId);
  if (at < 0) return shown[0];
  const visible = new Set(shown);
  for (let d = 0; d < presented.length; d++) {
    const near = [presented[at - d], presented[at + d]].find(
      (id) => id !== undefined && visible.has(id)
    );
    if (near) return near;
  }
  return shown[0];
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
