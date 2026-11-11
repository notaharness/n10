import {
  extraHeightOf,
  followEdge,
  followerOf,
  tileEdge,
} from '../../lib/tabs/supervise.js';
import {
  alreadyFollowing,
  followPlan,
  NO_ROOM_TO_FOLLOW,
  NO_ROOM_TO_TILE,
  tilePlan,
} from '../../lib/tabs/supervise-plan.js';
import type { TabFacts, TabGroup } from '../../lib/tabs/tab-groups.js';
import { useRequestAgentView } from '../../lib/tabs/tab-views.js';
import { useTabs, useWorkspace, type Tab } from '../../lib/tabs/tabs.js';
import { focusedPaneOf } from '../../lib/tabs/workspace.js';
import { sayPane } from './use-pane-menus.js';
import type { TabFace } from './use-strip-groups.js';

/** What a group's menu offers of the supervising layouts. */
export interface SuperviseMenu {
  canTile: boolean;
  tile(): void;
  canFollow: boolean;
  follow(): void;
}

/** The pane frame on screen, strip included. */
function frameOf(pane: string): DOMRect | null {
  return (
    document
      .querySelector(`[data-pane-id="${CSS.escape(pane)}"]`)
      ?.getBoundingClientRect() ?? null
  );
}

/**
 * Tile group and Follow group for this pane's strip: from a group's
 * menu, or from the palette for the active tab's group. Each says why
 * when it cannot (`supervise-plan.ts`); the room it needs is measured
 * on screen, the moves are the workspace's (`supervise.ts`).
 */
export function useSupervise(strip: {
  groups: readonly TabGroup[];
  faceOf(tab: Tab): TabFace;
  factsOf(tab: Tab): TabFacts;
  labelOf(group: TabGroup): string;
}) {
  const { groups, faceOf, factsOf, labelOf } = strip;
  const tabs = useTabs();
  const { workspace, dispatch } = useWorkspace();
  const requestAgentView = useRequestAgentView();
  const pane = tabs.paneId;
  const hasNewOutput = (tab: Tab) => faceOf(tab).status === 'new-output';
  const at = {
    order: tabs.tabs.map((t) => t.id),
    focused: tabs.focused,
    focusedActive: focusedPaneOf(workspace).activeId,
  };

  const nameOf = (key: string): string => {
    const group = groups.find((g) => !g.pinned && g.key === key);
    const pinned = groups.find((g) => g.affiliation?.key === key);
    return (
      workspace.groupNames[key] ??
      (group ? labelOf(group) : pinned?.affiliation?.label ?? key)
    );
  };
  const frame = () => frameOf(pane);
  const tile = (key: string) => {
    const planned = tilePlan(groups, key, factsOf);
    if (!planned.ok) return sayPane(planned.feedback);
    const box = frame();
    const edge = box && tileEdge(box);
    if (!edge) return sayPane(NO_ROOM_TO_TILE);
    dispatch({ type: 'tile-group', pane, key, edge, ...planned.plan });
  };
  const follow = (key: string) => {
    if (followerOf(workspace, key) !== undefined)
      return sayPane(alreadyFollowing(nameOf(key)));
    const planned = followPlan(groups, key, at, hasNewOutput);
    if (!planned.ok) return sayPane(planned.feedback);
    const { ids, show, inPlace } = planned.plan;
    const here = inPlace && workspace.follows[pane] === undefined;
    const box = here ? null : frame();
    const edge = box && followEdge(box, extraHeightOf(workspace)(pane));
    if (!here && !edge) return sayPane(NO_ROOM_TO_FOLLOW);
    // Its agent's output, not a pull request's overview.
    if (tabs.tabs.find((t) => t.id === show)?.kind === 'item')
      requestAgentView(show);
    dispatch({ type: 'follow-group', pane, key, ids, edge, show });
  };

  const activeKey = (): string | null => {
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    return active ? factsOf(active).affiliation?.key ?? null : null;
  };
  return {
    menuFor: (group: TabGroup): SuperviseMenu => ({
      canTile: tilePlan(groups, group.key, factsOf).ok,
      tile: () => tile(group.key),
      canFollow: followPlan(groups, group.key, at, hasNewOutput).ok,
      follow: () => follow(group.key),
    }),
    /** The palette's: the active tab's group. */
    tileActive: () => {
      const key = activeKey();
      if (key !== null) tile(key);
    },
    followActive: () => {
      const key = activeKey();
      if (key !== null) follow(key);
    },
  };
}
