import { useEffect, useLayoutEffect, useRef } from 'react';
import { hasUnseenOutput, snapshot } from '@n10/core';
import { enqueue as enqueueAlert } from '@n10/core';
import { useToastActions } from '../context/ToastContext.js';
import { useConfig } from '../context/ConfigContext.js';
import { useSessionData } from '../context/SessionContext.js';

const POLL_MS = 250;

/**
 * One watcher poll: every session's `active` flag now, and the sessions
 * that went active → idle with output the user has not seen.
 *
 * The idle edge trails the last output by ACTIVITY_IDLE_MS, so who is
 * viewed at the edge is not who watched the output: a user who leaves a
 * session inside that window has already seen everything it printed.
 * The currently-viewed session is skipped as well.
 *
 * An exited agent's active→idle transition is "the agent finished",
 * not "the agent is waiting on you", so it is skipped too (the
 * registry's onExit also removes any alert queued before it exited).
 */
export function pollIdleTransitions<S extends { name: string }>(
  sessions: readonly S[],
  prevActive: ReadonlyMap<string, boolean>,
  viewed: string | null
): { active: Map<string, boolean>; idle: S[] } {
  const active = new Map<string, boolean>();
  const idle: S[] = [];
  for (const s of sessions) {
    const snap = snapshot(s.name);
    active.set(s.name, snap.active);
    const wentIdle = prevActive.get(s.name) === true && !snap.active;
    if (
      wentIdle &&
      !snap.exited &&
      s.name !== viewed &&
      hasUnseenOutput(s.name)
    ) {
      idle.push(s);
    }
  }
  return { active, idle };
}

/**
 * Watches every running session's activity state and fires an info
 * toast + enqueues the session name into the inactive-alerts queue
 * when it goes idle with output the user has not seen
 * (`pollIdleTransitions`). Mount once at app level.
 *
 * Off-screen sidebar rows aren't mounted, so a per-row detector would
 * miss transitions for sessions the user hasn't scrolled to. This hook
 * iterates the SessionContext's full list, so every running session is
 * tracked regardless of sidebar visibility.
 */
export function useInactiveAlertWatcher(currentlyViewed: string | null): void {
  const { sessions } = useSessionData();
  const { flash } = useToastActions();
  const { config } = useConfig();

  const sessionsRef = useRef(sessions);
  const viewedRef = useRef(currentlyViewed);
  const jumpEnabledRef = useRef(config.jumpToInactiveOnEscape !== false);
  const prevActive = useRef<Map<string, boolean>>(new Map());

  useLayoutEffect(() => {
    sessionsRef.current = sessions;
    viewedRef.current = currentlyViewed;
    jumpEnabledRef.current = config.jumpToInactiveOnEscape !== false;
  });

  useEffect(() => {
    const id = setInterval(() => {
      const { active, idle } = pollIdleTransitions(
        sessionsRef.current,
        prevActive.current,
        viewedRef.current
      );
      prevActive.current = active;
      for (const s of idle) {
        flash(`${s.label ?? s.name} is idle`, 'info');
        if (jumpEnabledRef.current) enqueueAlert(s.name);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [flash]);
}
