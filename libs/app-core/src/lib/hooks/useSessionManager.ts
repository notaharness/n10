import { useEngine } from '../context/EngineContext.js';
import {
  useState,
  useEffect,
  useCallback,
  useEffectEvent,
  useSyncExternalStore,
} from 'react';
import {
  worktreeSessionRow,
  isSessionAlive,
  launchSession,
  onSessionExit,
  startSessionDiscovery,
} from '@n10/core';
import type { AgentSession, DiscoveredWorktree } from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { useLayout } from '../context/LayoutContext.js';
import { useToastActions } from '../context/ToastContext.js';

export function useSessionManager(
  repo: string,
  setBranches: (v: string[]) => void
) {
  const { terminal } = useLayout();
  const { worktrees } = useEngine();
  const { flash } = useToastActions();
  const snapshot = useSyncExternalStore(
    worktrees.subscribe,
    worktrees.getSnapshot
  );
  // Registry events change running flags without changing the checkout snapshot.
  const [, setSessionRevision] = useState(0);
  const sessions: AgentSession[] = snapshot.worktrees.map((wt) =>
    worktreeSessionRow(wt, isSessionAlive, repo)
  );
  const reportError = useEffectEvent(() => {
    if (snapshot.error) flash(snapshot.error, 'warning');
  });
  useEffect(() => reportError(), [snapshot.error]);

  const refreshSessions = useCallback(async () => {
    const next = await worktrees.refresh();
    setSessionRevision((value) => value + 1);
    return next.worktrees.map((wt) =>
      worktreeSessionRow(wt, isSessionAlive, repo)
    );
  }, [worktrees, repo]);

  // Discovery passes the actual checkout. Attaching never creates a new worktree.
  // The effect event reads the current terminal size at the moment of adoption.
  const adoptExternalSession = useEffectEvent(
    async (wt: DiscoveredWorktree) => {
      await launchSession({
        name: wt.name,
        mode: 'attach',
        cwd: wt.path,
        cols: terminal.paneCols,
        rows: terminal.paneRows,
        config: readConfig(repo),
        request: { intent: 'continue-or-blank' },
      });
    }
  );
  const onDiscovered = useEffectEvent(() => {
    void refreshSessions();
  });
  const startSessionManager = useEffectEvent(() => {
    let cancelled = false;
    void worktrees.refresh().then((next) => {
      if (!cancelled) setBranches(next.allBranches);
    });
    const discovery = startSessionDiscovery({
      repo,
      isCurrent: () => !cancelled,
      adopt: (wt) => adoptExternalSession(wt),
      onChanged: () => onDiscovered(),
    });
    const unsubscribe = onSessionExit(() => {
      if (!cancelled) setSessionRevision((value) => value + 1);
    });
    return () => {
      cancelled = true;
      discovery.stop();
      unsubscribe();
    };
  });
  useEffect(() => startSessionManager(), []);
  return { sessions, refreshSessions };
}
