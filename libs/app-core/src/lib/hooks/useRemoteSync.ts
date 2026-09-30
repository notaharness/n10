import {
  useCallback,
  useEffect,
  useEffectEvent,
  useSyncExternalStore,
} from 'react';
import type { SyncNotice } from '@n10/engine';
import { useEngine } from '../context/EngineContext.js';
import { useToastActions } from '../context/ToastContext.js';

export function useRemoteSync() {
  const { sync } = useEngine();
  const { flash } = useToastActions();
  const snapshot = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const announce = useEffectEvent((notice: SyncNotice) => {
    switch (notice.type) {
      case 'removed':
        flash(`Auto-deleted merged branch: ${notice.branch}`, 'success');
        break;
      case 'kept-branch':
        flash(
          `Auto-deleted the worktree of merged branch ${notice.branch}; kept the branch: it has commits made after the check`,
          'warning'
        );
        break;
      case 'rebase-in-progress':
        flash(
          `Auto-delete of ${notice.branch} skipped: rebase in progress`,
          'warning'
        );
        break;
      case 'failed':
        flash(`Sync failed: ${notice.error}`, 'warning');
    }
  });
  useEffect(() => {
    const unsubscribe = sync.subscribeNotices((notice) => announce(notice));
    sync.start();
    return () => {
      unsubscribe();
      void sync.stop();
    };
  }, [sync]);
  const triggerSync = useCallback(() => sync.refresh(), [sync]);
  return {
    lastSynced: snapshot.lastGitSyncAt ?? 0,
    isSyncing: snapshot.loading,
    mergedBranches: snapshot.merged,
    conflictCounts: snapshot.conflicts,
    triggerSync,
  };
}
