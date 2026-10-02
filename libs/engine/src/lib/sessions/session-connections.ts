import {
  getSession,
  getSpawnedAt,
  isSessionAlive,
  LOCAL_MACHINE,
  onSessionExit,
  releaseExitedSession,
  sessionIdentity,
  sessionNames,
} from '@n10/core';

/**
 * The worktree agents this process holds, across repository handles: a
 * running one, and one whose process ended with its tmux session kept
 * (its dead pane retained), which stays to be read and resumed. An
 * agent whose session itself is gone — stopped, killed with `tmux
 * kill-session`, its server ended — has nothing left to show, and is
 * released as it ends, as the terminal service releases a terminal's.
 */
export function createSessionConnections() {
  const offExit = onSessionExit((name) => {
    if (sessionIdentity(name)?.kind !== 'worktree') return;
    if (getSession(name)?.pty.processState?.gone) releaseExitedSession(name);
  });
  function read(repo: string) {
    return sessionNames().flatMap((name) => {
      const identity = sessionIdentity(name);
      if (identity?.kind !== 'worktree' || identity.repo !== repo) return [];
      const machine = identity.machine;
      return [
        {
          name,
          running: isSessionAlive(name),
          spawnedAt: getSpawnedAt(name) ?? 0,
          machine,
          connectionState:
            machine === LOCAL_MACHINE
              ? undefined
              : getSession(name)?.pty.connectionState,
        },
      ];
    });
  }
  return { read, dispose: offExit };
}
