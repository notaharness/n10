import { createRemoteSync, EMPTY_SYNC_SNAPSHOT } from '@n10/engine';
import type { ConfigService, RemoteSync, SyncNotice } from '@n10/engine';
import { activeConfigService } from './repo.js';
import { pullRequests } from './program.js';
import { worktreeCommands } from './worktrees.js';
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
      return { message: `Sync failed: ${notice.error}`, kind: 'warning' };
  }
}

export function setSyncNotifier(fn: (notice: SyncNoticeEvent) => void): void {
  notifier = fn;
}

export function getSyncDecorations() {
  return sync?.getSnapshot() ?? EMPTY_SYNC_SNAPSHOT;
}

/** Bind repository selection to engine lifetime; settings scheduling is internal. */
export function startRemoteSyncLoop(cwd: string): void {
  const current = activeConfigService();
  if (current.repo !== cwd) return;
  if (config !== current) {
    if (sync) void stop(sync);
    config = current;
    sync = createRemoteSync({
      config,
      pullRequests,
      worktrees: worktreeCommands(cwd),
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
