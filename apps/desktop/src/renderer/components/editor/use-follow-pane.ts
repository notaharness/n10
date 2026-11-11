import { useEffect, useRef } from 'react';
import { useDndContext } from '@dnd-kit/core';
import {
  followScheduler,
  type FollowScheduler,
} from '../../lib/tabs/follow-scheduler.js';
import {
  followedTabs,
  NOTHING_LEFT_TO_FOLLOW,
  stoppedFollowing,
} from '../../lib/tabs/supervise-plan.js';
import type { TabGroup } from '../../lib/tabs/tab-groups.js';
import { useRequestAgentView } from '../../lib/tabs/tab-views.js';
import { useTabs, useWorkspace, type Tab } from '../../lib/tabs/tabs.js';
import { isStripDragData } from './strip-drag.js';
import { sayPane } from './use-pane-menus.js';
import type { TabFace } from './use-strip-groups.js';

/** What a follow pane's line shows. */
export interface Following {
  name: string;
  paused: boolean;
  stop(): void;
}

const lines = (ids: readonly string[]) => ids.join('\n');
const unlines = (s: string) => (s ? s.split('\n') : []);

/**
 * This pane's following, when it follows a group: it switches to the
 * followed tab that last got new output (`follow-scheduler.ts`), never
 * taking focus, and pauses while the user is in the pane — it has focus,
 * or a tab is dragged from it. Only a change from no new output to new
 * output counts: what was waiting when following began shows only if it
 * was chosen then. A tab pinned or moved out is no longer followed;
 * with none left, following stops.
 */
export function useFollowPane(strip: {
  groups: readonly TabGroup[];
  faceOf(tab: Tab): TabFace;
  labelOf(group: TabGroup): string;
}): Following | null {
  const tabs = useTabs();
  const { workspace, dispatch } = useWorkspace();
  const requestAgentView = useRequestAgentView();
  const { active: dragged } = useDndContext();
  const pane = tabs.paneId;
  const key = workspace.follows[pane];
  const followed = key === undefined ? [] : followedTabs(strip.groups, key);
  const ids = lines(followed.map((t) => t.id));
  const fresh = lines(
    followed
      .filter((t) => strip.faceOf(t).status === 'new-output')
      .map((t) => t.id)
  );
  const drag = dragged?.data.current;
  const paused = tabs.focused || (isStripDragData(drag) && drag.pane === pane);

  const latest = useRef<{
    ids: string;
    activeId: string | null;
    show: ((id: string) => void) | null;
  }>({ ids, activeId: tabs.activeId, show: null });
  useEffect(() => {
    latest.current = {
      ids,
      activeId: tabs.activeId,
      show: (id) => {
        if (tabs.tabs.find((t) => t.id === id)?.kind === 'item')
          requestAgentView(id);
        dispatch({ type: 'follow-show', pane, id });
      },
    };
  });

  const scheduler = useRef<FollowScheduler | null>(null);
  const before = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (key === undefined) return;
    const s = followScheduler({
      rank: (id) => unlines(latest.current.ids).indexOf(id),
      shown: () => latest.current.activeId,
      show: (id) => latest.current.show?.(id),
    });
    scheduler.current = s;
    before.current = null;
    return () => {
      s.dispose();
      scheduler.current = null;
    };
  }, [key]);

  useEffect(() => {
    const s = scheduler.current;
    if (!s) return;
    const now = new Set(unlines(fresh));
    const was = before.current;
    before.current = now;
    // What waits when following begins is where it starts, not a switch.
    if (was === null) return;
    for (const id of now) if (!was.has(id)) s.note(id);
    for (const id of was) if (!now.has(id)) s.forget(id);
  }, [fresh, key]);

  useEffect(() => {
    scheduler.current?.setPaused(paused);
  }, [paused, key]);

  const empty = key !== undefined && ids === '';
  useEffect(() => {
    if (!empty) return;
    dispatch({ type: 'stop-following', pane });
    sayPane(NOTHING_LEFT_TO_FOLLOW);
  }, [empty, dispatch, pane]);

  if (key === undefined) return null;
  const group = strip.groups.find((g) => !g.pinned && g.key === key);
  const name =
    workspace.groupNames[key] ?? (group ? strip.labelOf(group) : key);
  return {
    name,
    paused,
    stop: () => {
      dispatch({ type: 'stop-following', pane });
      sayPane(stoppedFollowing(name));
    },
  };
}
