import { isHomeTab, type TabFacts, type TabGroup } from './tab-groups.js';
import type { Tab } from './tab-identity.js';

/**
 * Which tabs Tile group and Follow group take from a pane's strip, and
 * what each says when it cannot: pure, over the pane's presented groups
 * (`present`). The workspace moves the tabs (`supervise.ts`).
 */

export const TILE_NEEDS_HOME = "Open this group's orchestrator here to tile it";
export const NO_PLAYERS = 'No players to tile';
export const NO_ROOM_TO_TILE = 'Not enough room to tile group';
export const NOTHING_TO_FOLLOW = 'No tabs available to follow';
export const NO_ROOM_TO_FOLLOW = 'Not enough room for a follow pane';
export const NOTHING_LEFT_TO_FOLLOW = 'No tabs left to follow';
export const alreadyFollowing = (group: string) => `Already following ${group}`;
export const stoppedFollowing = (group: string) => `Stopped following ${group}`;

/** A plan, or why there is none. */
export type Planned<T> =
  | { ok: true; plan: T }
  | { ok: false; feedback: string };

/** The home's tab of group `key` in this pane: its head, or the home
 *  pinned out of the group. */
function homeOf(
  groups: readonly TabGroup[],
  key: string,
  facts: (tab: Tab) => TabFacts
): Tab | null {
  const group = groups.find((g) => !g.pinned && g.key === key);
  if (group?.head) return group.head;
  for (const g of groups) {
    const a = g.affiliation;
    const tab = g.tabs[0];
    if (!g.pinned || !tab || a?.kind !== 'parent' || a.key !== key) continue;
    if (a.home && isHomeTab(tab, facts(tab), a.home)) return tab;
  }
  return null;
}

/** A group's members a layout may move: the unpinned ones, its home
 *  aside. */
function playersOf(groups: readonly TabGroup[], key: string): Tab[] {
  const group = groups.find((g) => !g.pinned && g.key === key);
  if (!group) return [];
  return group.tabs.filter((t) => t !== group.head);
}

export interface TilePlan {
  home: string;
  players: string[];
}

/** Tile group `key`: its home in this pane stays, every other unpinned
 *  member goes. Only a parent group whose home is here tiles. */
export function tilePlan(
  groups: readonly TabGroup[],
  key: string,
  facts: (tab: Tab) => TabFacts
): Planned<TilePlan> {
  const home = homeOf(groups, key, facts);
  if (!home) return { ok: false, feedback: TILE_NEEDS_HOME };
  const players = playersOf(groups, key).map((t) => t.id);
  if (players.length === 0) return { ok: false, feedback: NO_PLAYERS };
  return { ok: true, plan: { home: home.id, players } };
}

export interface FollowPlan {
  ids: string[];
  /** The tab the follow pane shows first. */
  show: string;
  /** Every tab of the pane goes, and it has no focus: it follows in
   *  place rather than splitting. */
  inPlace: boolean;
}

/**
 * Follow group `key` from this pane: its unpinned members but the home
 * and the tab the focused pane shows, which stay where they are. The
 * follow pane shows the first with new output waiting, else the first.
 */
export function followPlan(
  groups: readonly TabGroup[],
  key: string,
  pane: {
    order: readonly string[];
    focused: boolean;
    /** The active tab of the focused pane, wherever that is. */
    focusedActive: string | null;
  },
  hasNewOutput: (tab: Tab) => boolean
): Planned<FollowPlan> {
  const eligible = playersOf(groups, key).filter(
    (t) => t.id !== pane.focusedActive
  );
  if (eligible.length === 0) return { ok: false, feedback: NOTHING_TO_FOLLOW };
  const ids = eligible.map((t) => t.id);
  const show = (eligible.find(hasNewOutput) ?? eligible[0]!).id;
  const inPlace = !pane.focused && pane.order.every((id) => ids.includes(id));
  return { ok: true, plan: { ids, show, inPlace } };
}

/** The tabs a follow pane follows: its unpinned members of the group it
 *  follows, the home aside, in presented order. */
export function followedTabs(groups: readonly TabGroup[], key: string): Tab[] {
  return playersOf(groups, key);
}
