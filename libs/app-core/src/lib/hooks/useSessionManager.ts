import { useEffect, useEffectEvent, useSyncExternalStore } from 'react';
import { useEngine } from '../context/EngineContext.js';
import { useLayout } from '../context/LayoutContext.js';
import { useToastActions } from '../context/ToastContext.js';

/** Adapt the engine's session observation to React and the current terminal size. */
export function useSessionManager(setBranches: (v: string[]) => void) {
  const { terminal } = useLayout();
  const { sessions, worktrees } = useEngine();
  const { flash } = useToastActions();
  const snapshot = useSyncExternalStore(
    sessions.subscribe,
    sessions.getSnapshot
  );
  const reportError = useEffectEvent(() => {
    if (snapshot.error) flash(snapshot.error, 'warning');
  });
  useEffect(() => reportError(), [snapshot.error]);
  const size = useEffectEvent(() => ({
    cols: terminal.paneCols,
    rows: terminal.paneRows,
  }));
  const start = useEffectEvent(() => {
    let stopped = false;
    const unwatch = sessions.watch({ size: () => size() });
    void worktrees.read().then((next) => {
      if (!stopped) setBranches(next.allBranches);
    });
    return () => {
      stopped = true;
      unwatch();
    };
  });
  useEffect(() => start(), []);
  return { sessions: snapshot.sessions, refreshSessions: sessions.refresh };
}
