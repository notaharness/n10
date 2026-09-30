import { worktreeSessionRow } from '@n10/core';
import { useState, useEffect, useCallback, useEffectEvent } from 'react';
import { listAllBranches, listWorktrees } from '@n10/worktree-manager';
import type {
  AgentSession,
  DiscoveredWorktree,
  WorktreeRemovalCheck,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import {
  removeWorktreeSession,
  isSessionAlive,
  launchSession,
  onSessionExit,
  startSessionDiscovery,
} from '@n10/core';
import { useLayout } from '../context/LayoutContext.js';

export function useSessionManager(
  repo: string,
  setBranches: (v: string[]) => void
) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [worktreeBranches, setWorktreeBranches] = useState<string[]>([]);
  const { terminal } = useLayout();

  const refreshSessions = useCallback(async () => {
    const worktrees = await listWorktrees(repo);
    const filtered: AgentSession[] = worktrees.map((wt) =>
      worktreeSessionRow(wt, isSessionAlive)
    );
    setSessions(filtered);
    // Detached-HEAD orphans have an empty branch; drop them here so the
    // merged/conflict git queries (countConflicts, fetchMergedBranches)
    // never run against an empty ref.
    setWorktreeBranches(worktrees.map((wt) => wt.branch).filter(Boolean));
    return filtered;
  }, [repo]);

  // No refresh of its own: core's removal has discovery look again, and
  // `onDiscovered` below re-reads the rows, as it does for a worktree
  // removed outside n10.
  const performDelete = useCallback(
    (_sessionName: string, branch: string, approved: WorktreeRemovalCheck) =>
      removeWorktreeSession(branch, approved, repo),
    [repo]
  );

  // Attach to an agent session that was started outside this process —
  // another n10, an Orchestra spawn, someone tagging a `tmux
  // new-session` by hand. This is the ordinary launch path: on the tmux
  // backend the factory resolves the running session by its tags and
  // attaches to it rather than starting a second one, and discovery
  // only ever offers a session the registry holds no live PTY for.
  //
  // An effect event, so it reads the pane size at the moment it
  // attaches. A plain closure would capture whatever the terminal was
  // when discovery started and size every later agent to that.
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

  // Something changed the worktrees or the live sessions — outside this
  // process, or a removal core made here. Both are read from disk by
  // refreshSessions, so re-reading is the whole response.
  const onDiscovered = useEffectEvent(() => {
    void refreshSessions();
  });

  const startSessionManager = useEffectEvent(() => {
    let cancelled = false;

    void (async () => {
      if (cancelled) return;
      await refreshSessions();
      const allBranches = await listAllBranches(repo);
      if (!cancelled) setBranches(allBranches);
    })();

    const discovery = startSessionDiscovery({
      isCurrent: () => !cancelled,
      adopt: (wt) => adoptExternalSession(wt),
      onChanged: () => onDiscovered(),
    });

    // Flip the row's running indicator (green → gray) when an agent PTY
    // exits on its own. An exit changes nothing about the worktree list,
    // so flip the one session's flag in place rather than shelling out
    // to git via refreshSessions() — several agents exiting at once
    // would otherwise spawn a listWorktrees(repo) storm to update one bool.
    const unsubscribe = onSessionExit((name) => {
      if (cancelled) return;
      setSessions((prev) =>
        prev.map((s) => (s.name === name ? { ...s, running: false } : s))
      );
    });

    return () => {
      cancelled = true;
      discovery.stop();
      unsubscribe();
    };
  });

  useEffect(() => startSessionManager(), []);

  return {
    sessions,
    worktreeBranches,
    refreshSessions,
    performDelete,
  };
}
