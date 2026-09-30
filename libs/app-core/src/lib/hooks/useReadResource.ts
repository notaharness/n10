import { useEffect, useSyncExternalStore } from 'react';
import type { ReadResource, ReadSnapshot } from '@n10/engine';

const EMPTY = { data: null, loading: false, error: null, fetchedAt: null };
const emptySnapshot = () => EMPTY;
const noSubscription = () => () => undefined;

/** React owns visibility; the engine owns data, freshness and read ordering. */
export function useReadResource<T>(
  resource: ReadResource<T> | null
): ReadSnapshot<T> {
  const snapshot = useSyncExternalStore(
    resource?.subscribe ?? noSubscription,
    resource?.getSnapshot ?? emptySnapshot
  );
  useEffect(() => {
    if (resource) void resource.read();
  }, [resource]);
  return snapshot;
}
