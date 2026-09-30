import {
  getSession,
  getSpawnedAt,
  isSessionAlive,
  LOCAL_MACHINE,
  sessionIdentity,
  sessionNames,
} from '@n10/core';

/** Process-lifetime history preserves stopped agents as relaunch targets. */
export function createSessionConnections() {
  const observed = new Set<string>();
  return (repo: string) => {
    for (const name of sessionNames()) observed.add(name);
    return [...observed].flatMap((name) => {
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
  };
}
