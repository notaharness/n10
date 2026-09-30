const REMOTE_SYNC_DEFAULT_MS = 3_600_000; // 1 hour
const REMOTE_SYNC_MIN_MS = 300_000; // 5 minutes

export function remoteSyncIntervalMs(
  mergePollInterval: number | undefined
): number {
  return Math.max(
    REMOTE_SYNC_MIN_MS,
    typeof mergePollInterval === 'number' && Number.isFinite(mergePollInterval)
      ? mergePollInterval
      : REMOTE_SYNC_DEFAULT_MS
  );
}
