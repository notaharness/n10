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
  type DiscoveryScan,
  type SessionDiscovery,
} from '@n10/core';
import type { DiscoveryChangedEvent } from '../contract.js';
import { activeRepoIs } from './repo.js';
import { launchAgent } from './sessions.js';
import { adoptTerminal, forgetTerminal } from './terminals.js';

let discovery: SessionDiscovery | null = null;
/** The repository `discovery` scans. */
let discoveryCwd: string | null = null;
/** What each repository's scanner last saw before another repository
 *  was opened. Its next scanner starts from there, so reopening it
 *  reports the worktrees removed meanwhile, and their tabs close. */
const lastScans = new Map<string, DiscoveryScan>();

// Installed by main.ts. Fires when discovery changed what
// getSidebarModel() would answer.
let changed: ((event: DiscoveryChangedEvent) => void) | null = null;

export function setDiscoveryNotifier(
  fn: ((event: DiscoveryChangedEvent) => void) | null
): void {
  changed = fn;
}

async function attach(worktree: DiscoveredWorktree): Promise<void> {
  // The session is keyed by its checkout, but the desktop's rows and
  // tabs for a worktree still name it by branch — a launch request, an
  // item key — and a detached HEAD has none, so its agent is left to
  // the TUI. Thrown rather than skipped so the scanner stops offering
  // it every tick.
  if (!worktree.branch) {
    throw new Error(
      `Cannot attach to ${worktree.name}: the worktree has no branch checked out`
    );
  }
  // The scanner already resolved the checkout from git; handing it over
  // is what lets a worktree in a non-canonical directory be attached to
  // at all, since `createWorktree` would otherwise re-derive the path
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
  discoveryCwd = cwd;
  discovery = startSessionDiscovery({
    baseline: lastScans.get(cwd),
    isCurrent: () => activeRepoIs(cwd),
    adopt: attach,
    // Terminal tabs come back the same way — the first scan is what
    // reopens every one that survived the last run, in whatever
    // directory tmux remembers for it.
    adoptTerminal: (terminal) => adoptTerminal(terminal),
    onChanged: (delta) => {
      for (const name of delta.endedTerminals) forgetTerminal(name);
      // Named by checkout, which is what a worktree's tab remembers:
      // its branch may have changed since, and its row is gone.
      changed?.({
        repo: cwd,
        removedWorktrees: delta.disappeared.map((wt) => wt.path),
      });
    },
  });
}

/**
 * The sidebar just showed these checkouts of `cwd`.
 *
 * Discovery reports only the removal of a worktree it has seen, and the
 * renderer may hold a tab for any worktree the sidebar showed. So one
 * the scanner has not seen yet — made a moment ago, by n10 or not — is
 * scanned for now rather than at the next tick, or a worktree removed
 * before that tick would leave its tab behind.
 */
export function noteListedWorktrees(
  cwd: string,
  paths: readonly string[]
): void {
  if (!discovery || discoveryCwd !== cwd) return;
  const seen = new Set(discovery.lastScan()?.worktrees.map((wt) => wt.path));
  // `scanNow` settles every scan itself and never rejects.
  if (paths.some((path) => !seen.has(path))) void discovery.scanNow();
}

/** Stop discovery. Idempotent; safe to call with none running. */
export function stopDiscovery(): void {
  const scan = discovery?.lastScan();
  if (scan && discoveryCwd) lastScans.set(discoveryCwd, scan);
  discovery?.stop();
  discovery = null;
  discoveryCwd = null;
}
