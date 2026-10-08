import { createRemoteSync, EMPTY_SYNC_SNAPSHOT } from '@n10/engine';
import type {
  ConfigService,
  RemoteSync,
  SyncNotice,
  SyncSnapshot,
} from '@n10/engine';
import { activeConfigService, activeWorktreeService } from './repo.js';
import { pullRequests } from './program.js';
import type { SyncNoticeEvent } from '../contract.js';

const stopping = new Set<Promise<void>>();

function stop(service: RemoteSync): Promise<void> {
  const pending = service.stop();
  stopping.add(pending);
  void pending.then(() => stopping.delete(pending));
  return pending;
}

let config: ConfigService | undefined;
let sync: RemoteSync | undefined;
// What each repository's loop last said when another was opened: a
// pane of a parked repository shows its rows as they were decorated.
const parked = new Map<string, SyncSnapshot>();
let notifier: ((notice: SyncNoticeEvent) => void) | null = null;

function present(notice: SyncNotice): SyncNoticeEvent {
  switch (notice.type) {
    case 'removed':
      return {
        message: `Auto-deleted merged branch: ${notice.branch}`,
        kind: 'success',
      };
    case 'kept-branch':
      return {
        message: `Auto-deleted the worktree of merged branch ${notice.branch}; kept the branch: it has commits made after the check`,
        kind: 'warning',
      };
    case 'rebase-in-progress':
      return {
        message: `Auto-delete of ${notice.branch} skipped: rebase in progress`,
        kind: 'warning',
      };
    case 'failed':
      return { message: notice.error, kind: 'warning' };
  }
}

export function setSyncNotifier(fn: (notice: SyncNoticeEvent) => void): void {
  notifier = fn;
}

export function getSyncDecorations(cwd: string): SyncSnapshot {
  if (sync && config?.repo === cwd) return sync.getSnapshot();
  return parked.get(cwd) ?? EMPTY_SYNC_SNAPSHOT;
}

/** Bind repository selection to engine lifetime; settings scheduling is internal. */
export function startRemoteSyncLoop(cwd: string): void {
  const current = activeConfigService();
  if (current.repo !== cwd) return;
  if (config !== current) {
    if (sync && config) {
      parked.set(config.repo, sync.getSnapshot());
      void stop(sync);
    }
    parked.delete(current.repo);
    config = current;
    sync = createRemoteSync({
      config,
      pullRequests,
      worktrees: activeWorktreeService(),
    });
    sync.subscribeNotices((notice) => {
      const event = present(notice);
      if (notice.repo !== config?.repo) event.message += ` (${notice.repo})`;
      notifier?.(event);
    });
  }
  sync?.start();
}

export async function stopRemoteSyncLoop(): Promise<void> {
  if (sync) void stop(sync);
  await Promise.all(stopping);
}

export function refreshRemoteSync(): Promise<void> {
  return sync?.refresh() ?? Promise.resolve();
}
