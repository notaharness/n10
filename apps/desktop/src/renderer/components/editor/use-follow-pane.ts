import { useEffect, useRef } from 'react';
import {
  followScheduler,
  type FollowScheduler,
} from '../../lib/tabs/follow-scheduler.js';
import {
  NOTHING_LEFT_TO_FOLLOW,
  stoppedFollowing,
} from '../../lib/tabs/supervise-plan.js';
import { presentedIds, type TabGroup } from '../../lib/tabs/tab-groups.js';
import { useRequestAgentView } from '../../lib/tabs/tab-views.js';
import { useTabs, useWorkspace, type Tab } from '../../lib/tabs/tabs.js';
import type { Following } from '../../lib/tabs/workspace.js';
import { sayPane } from './use-pane-menus.js';
import type { TabFace } from './use-strip-groups.js';

/** What a follow pane's line shows. */
export interface FollowLineState {
  paused: boolean;
  stop(): void;
}

/** The workspace's view of this pane, kept current for the scheduler's
 *  callbacks, which outlive a render. */
interface Latest {
  order: readonly string[];
  activeId: string | null;
  show: ((id: string) => void) | null;
}

/**
 * Pane `pane`'s following, while it follows `following`: it switches to
 * the followed tab that last got new output (`follow-scheduler.ts`),
 * never taking focus, and pauses while the pane is the focused one — a
 * drag from it or a menu on it focuses it first. Which tabs it follows
 * is the workspace's (`Following.ids`), not the strip's grouping, so a
 * gap in the listings ends nothing.
 */
export function useFollowPane(strip: {
  following: Following;
  groups: readonly TabGroup[];
  faceOf(tab: Tab): TabFace;
  activitySource: string | null;
}): FollowLineState {
  const tabs = useTabs();
  const { dispatch } = useWorkspace();
  const requestAgentView = useRequestAgentView();
  const pane = tabs.paneId;
  const followed = new Set(strip.following.ids);
  // Presented order, for ties.
  const order = presentedIds(strip.groups).filter((id) => followed.has(id));
  const fresh = tabs.tabs
    .filter(
      (t) => followed.has(t.id) && strip.faceOf(t).status === 'new-output'
    )
    .map((t) => t.id)
    .join('\n');
  const paused = tabs.focused;

  const latest = useRef<Latest>({ order, activeId: null, show: null });
  useEffect(() => {
    latest.current = {
      order,
      activeId: tabs.activeId,
      show: (id) => {
        // Its agent's output, not a pull request's overview.
        if (tabs.tabs.find((t) => t.id === id)?.kind === 'item')
          requestAgentView(id);
        dispatch({ type: 'follow-show', pane, id });
      },
    };
  });

  const scheduler = useRef<FollowScheduler | null>(null);
  useEffect(() => {
    const s = followScheduler({
      rank: (id) => latest.current.order.indexOf(id),
      shown: () => latest.current.activeId,
      show: (id) => latest.current.show?.(id),
    });
    scheduler.current = s;
    return () => {
      s.dispose();
      scheduler.current = null;
    };
  }, []);

  const source = strip.activitySource;
  useEffect(() => {
    scheduler.current?.observe(fresh ? fresh.split('\n') : [], source);
  }, [fresh, source]);

  useEffect(() => {
    scheduler.current?.setPaused(paused);
  }, [paused]);

  return {
    paused,
    stop: () => dispatch({ type: 'stop-following', pane }),
  };
}

/**
 * What this pane says when its following ends while the pane stays:
 * "No tabs left to follow" when none of the tabs it followed is still
 * here unpinned, else "Stopped following {group}" (Stop following, or
 * the pane left the only one). A pane that closes says nothing.
 */
export function useFollowEnded(nameOf: (key: string) => string): void {
  const tabs = useTabs();
  const { workspace } = useWorkspace();
  const following = workspace.follows[tabs.paneId];
  const last = useRef(following);
  const pinned = new Set(tabs.pinned);
  const held = (id: string) =>
    !pinned.has(id) && tabs.tabs.some((t) => t.id === id);
  useEffect(() => {
    const ended = last.current;
    last.current = following;
    if (!ended || following) return;
    sayPane(
      ended.ids.some(held)
        ? stoppedFollowing(nameOf(ended.key))
        : NOTHING_LEFT_TO_FOLLOW
    );
  });
}
