import { activeRepository } from './repo.js';
import { adoptSession } from './session-registry.js';
import { defaultPaneSize } from './sessions.js';
import { refuseIfRemoteOwns } from './plan-remote-owner.js';
import { adoptTerminal, forgetTerminal } from './terminals.js';

let stop: (() => void) | undefined;
let changed: (() => void) | null = null;

export function setDiscoveryNotifier(fn: (() => void) | null): void {
  changed = fn;
}

/** Adapt repository observation to output relays and renderer notifications. */
export function startDiscoveryForRepo(cwd: string): void {
  stopDiscovery();
  const repo = activeRepository();
  if (repo.cwd !== cwd) return;
  stop = repo.sessions.watch({
    size: defaultPaneSize,
    beforeLaunch: async (branch, name) => {
      if (!branch)
        throw new Error(
          'Cannot attach: the worktree has no branch checked out'
        );
      await refuseIfRemoteOwns(repo.cwd, branch, name);
    },
    started: adoptSession,
    adoptTerminal,
    changed(delta) {
      for (const name of delta.endedTerminals) forgetTerminal(name);
      changed?.();
    },
  });
}

export function stopDiscovery(): void {
  stop?.();
  stop = undefined;
}
