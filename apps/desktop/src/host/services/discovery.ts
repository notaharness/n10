/**
 * Host-side ownership of external-session discovery.
 *
 * The scanning, the diffing and the decision about what may be attached
 * to all live in `@n10/core`; what the desktop adds is the same thing
 * it adds to every other launch — its own bookkeeping (`launchAgent`
 * records the session and starts the output relay) and a push to the
 * renderer, which serves its sidebar from a query cache and would
 * otherwise wait out its poll interval.
 */
import {
  startSessionDiscovery,
  type DiscoveredWorktree,
  type SessionDiscovery,
} from '@n10/core';
import { activeRepoIs } from './repo.js';
import { launchAgent } from './sessions.js';
import { adoptTerminal, forgetTerminal } from './terminals.js';

let discovery: SessionDiscovery | null = null;

// Installed by main.ts. Fires when discovery changed what
// getSidebarModel() would answer.
let changed: (() => void) | null = null;

export function setDiscoveryNotifier(fn: (() => void) | null): void {
  changed = fn;
}

async function attach(worktree: DiscoveredWorktree): Promise<void> {
  // The scanner already resolved the checkout from git, and the session
  // is keyed by that checkout: handing it over is what attaches a
  // worktree in a non-canonical directory, or on a detached HEAD with
  // no branch at all, where `createWorktree` would re-derive a path
  // from the branch name and miss it.
  await launchAgent(
    { branch: worktree.branch, intent: 'continue-or-blank' },
    worktree.path
  );
}

/**
 * Begin discovery for a repository, replacing any previous run.
 *
 * Called on every repo open. The `isCurrent` guard is what keeps a scan
 * that started before a repo switch from finishing against the new one:
 * `launchAgent` would take this repo's branch names and happily create
 * them over there.
 */
export function startDiscoveryForRepo(cwd: string): void {
  stopDiscovery();
  discovery = startSessionDiscovery({
    isCurrent: () => activeRepoIs(cwd),
    adopt: attach,
    // Terminal tabs come back the same way — the first scan is what
    // reopens every one that survived the last run, in whatever
    // directory tmux remembers for it.
    adoptTerminal: (terminal) => adoptTerminal(terminal),
    onChanged: (delta) => {
      for (const name of delta.endedTerminals) forgetTerminal(name);
      changed?.();
    },
  });
}

/** Stop discovery. Idempotent; safe to call with none running. */
export function stopDiscovery(): void {
  discovery?.stop();
  discovery = null;
}
