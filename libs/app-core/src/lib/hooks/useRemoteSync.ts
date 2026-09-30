import { useCallback } from 'react';
import { useConfig } from '../context/ConfigContext.js';
import { remoteSyncIntervalMs, syncRemote } from '@n10/core';
import { usePolling } from './usePolling.js';

/** TUI scheduling shell around the shared {@link syncRemote} pass. */
export function useRemoteSync() {
  const { vcsConfigured, config, repo, syncRevision } = useConfig();

  const interval = remoteSyncIntervalMs(config.mergePollInterval);
  const sync = useCallback(() => syncRemote(repo), [repo]);
  const polling = usePolling<number>(
    sync,
    interval,
    vcsConfigured,
    syncRevision
  );

  return {
    lastSynced: polling.value ?? 0,
    isSyncing: polling.loading,
    triggerSync: polling.refresh,
  };
}
