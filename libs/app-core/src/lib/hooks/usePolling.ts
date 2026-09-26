import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingState<T> {
  value: T | undefined;
  error: Error | null;
  loading: boolean;
  /** Fire the fetch immediately, outside the interval. */
  refresh: () => Promise<void>;
}

// Small ~30-line polling primitive. Picked over TanStack Query because:
// - TanStack Query adds ~18KB gzipped for what 4 hooks need to do.
// - Its cache+retry machinery is irrelevant in a single-user CLI.
// - Its React dev warnings under Ink are an unknown we don't need to
//   find out about in production.
// See Step 23 of the React refactor plan for the full trade-off.
export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  enabled = true
): PollingState<T> {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  // One request at a time, so results commit in the order they were
  // asked for: a slow older request cannot overwrite a newer one, and a
  // pass with side effects (remote sync) never overlaps itself. Neither
  // promise rejects.
  const inFlightRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef<Promise<void> | null>(null);

  const start = useCallback((): Promise<void> => {
    setLoading(true);
    const run = (async () => {
      try {
        const v = await fnRef.current();
        if (mountedRef.current) {
          setValue(v);
          setError(null);
        }
      } catch (err: unknown) {
        if (mountedRef.current) setError(err as Error);
      }
    })().finally(() => {
      inFlightRef.current = null;
      if (!queuedRef.current && mountedRef.current) setLoading(false);
    });
    inFlightRef.current = run;
    return run;
  }, []);

  const refresh = useCallback((): Promise<void> => {
    const inFlight = inFlightRef.current;
    if (!inFlight) return start();
    // The request already out may predate whatever prompted this ask,
    // so one fresh request follows it; asks meanwhile share that one.
    queuedRef.current ??= inFlight.then(() => {
      queuedRef.current = null;
      return mountedRef.current ? start() : undefined;
    });
    return queuedRef.current;
  }, [start]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }
    void refresh();
    // A tick while a request is out is skipped, not queued: the next
    // tick comes round soon enough.
    const timer = setInterval(() => {
      if (!inFlightRef.current) void start();
    }, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [enabled, intervalMs, refresh, start]);

  return { value, error, loading, refresh };
}
