import { setUpdatesNotifier } from './services/updates.js';
/**
 * Everything the host pushes to windows without being asked, plus the
 * per-repo background work that produces most of it. Each service
 * exposes a setter rather than reaching for a transport, so the host
 * runs the same whether it sits in the main process or in its own
 * utility process: the caller supplies how a push leaves.
 */
import {
  BABYSIT_EVENTS,
  DISCOVERY_EVENTS,
  MACHINES_EVENTS,
  SYNC_EVENTS,
  UPDATE_EVENTS,
} from './contract.js';
import { setRepoOpenedListener } from './services/repo.js';
import {
  setSyncNotifier,
  startRemoteSyncLoop,
} from './services/remote-sync.js';
import { setRemoteUpdatedNotifier } from './services/pull-requests.js';
import {
  setDiscoveryNotifier,
  startDiscoveryForRepo,
} from './services/discovery.js';
import { setSessionBroadcaster } from './services/sessions.js';
import { setBabysitNotifier } from './services/babysit.js';
import {
  setBeamStatusNotifier,
  setCeremonyProgressNotifier,
  setDirectoryPublishedNotifier,
  setMachinesNotifier,
} from './services/machines.js';
import type { Viewer } from './services/session-watch.js';

export interface HostPushes {
  /** To every window. */
  broadcast(channel: string, payload?: unknown): void;
  /** To one window: PTY output goes only to the windows watching. */
  sendTo(viewer: Viewer, channel: string, payload: unknown): void;
}

/** Wire every host → window push, and the per-repo loops behind them.
 *  Call once, before the first repo is opened. */
export function installHostPushes({ broadcast, sendTo }: HostPushes): void {
  setSessionBroadcaster(broadcast, sendTo);
  setUpdatesNotifier((snapshot) => broadcast(UPDATE_EVENTS.changed, snapshot));

  // Per-repo background work, (re)started whenever a repo is opened.
  // The sync loop's user-facing events (auto-deleted merged branch, …)
  // toast in the renderer; discovery attaches to agent sessions this
  // process did not start — including the ones that survived a previous
  // run, which is what makes them show as running straight away.
  setRepoOpenedListener((cwd) => {
    startRemoteSyncLoop(cwd);
    startDiscoveryForRepo(cwd);
  });

  setSyncNotifier((notice) => broadcast(SYNC_EVENTS.notice, notice));

  // The sidebar model answers from local git without waiting for the
  // provider, so the renderer needs telling when the pull requests
  // finally arrive — otherwise they wait out its poll interval.
  setRemoteUpdatedNotifier(() => broadcast(SYNC_EVENTS.remote));

  // Same idea for the local half: a worktree or session that appeared
  // or went away changes what the sidebar should show, and the renderer
  // is serving it from a query cache.
  setDiscoveryNotifier((event) => broadcast(DISCOVERY_EVENTS.changed, event));

  // A babysitter started an agent (a row and a session) or ended; its
  // status otherwise rides on the sidebar item.
  setBabysitNotifier((event) => broadcast(BABYSIT_EVENTS.changed, event));

  // The machines list is pushed whole on every change the beam daemon
  // reports, so the renderer writes it straight into the query cache
  // with no round trip; the daemon's status and a running ceremony's
  // progress likewise. Repo-independent, like the bridges above.
  setMachinesNotifier((machines) =>
    broadcast(MACHINES_EVENTS.changed, machines)
  );
  setBeamStatusNotifier((status) =>
    broadcast(MACHINES_EVENTS.beamStatus, status)
  );
  setCeremonyProgressNotifier((progress) =>
    broadcast(MACHINES_EVENTS.ceremony, progress)
  );
  setDirectoryPublishedNotifier((landed) =>
    broadcast(MACHINES_EVENTS.published, landed)
  );
}
