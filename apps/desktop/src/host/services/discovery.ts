import { activeRepository } from './repo.js';
import { adoptSession } from './session-registry.js';
import { defaultPaneSize } from './sessions.js';
import { machines } from './machines.js';
import { adoptTerminal, forgetTerminal } from './terminals.js';
import type { DiscoveryChangedEvent } from '../contract.js';

let stop: (() => void) | undefined;
let changed: ((event: DiscoveryChangedEvent) => void) | null = null;

export function setDiscoveryNotifier(
  fn: ((event: DiscoveryChangedEvent) => void) | null
): void {
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
      await machines.refuseIfRemoteOwns(repo.cwd, branch, name);
    },
    started: adoptSession,
    adoptTerminal,
    remoteMachines: () =>
      machines
        .getSnapshot()
        .machines.filter((m) => !m.isLocal && m.state === 'connected')
        .map((m) => m.peerId),
    changed(delta) {
      for (const name of delta.endedTerminals) forgetTerminal(name);
      // Named by checkout, which is what a worktree's tab remembers:
      // its branch may have changed since, and its row is gone.
      changed?.({
        repo: repo.cwd,
        removedWorktrees: delta.disappeared.map((wt) => wt.path),
      });
    },
  });
}

export function stopDiscovery(): void {
  stop?.();
  stop = undefined;
}
