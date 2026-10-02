import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingState<T> {
  value: T | undefined;
  error: Error | null;
  loading: boolean;
  /** Fire the fetch immediately, outside the interval. */
  refresh: () => Promise<void>;
}

/** Polling adapter for resources awaiting engine migration. */
export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  enabled = true
): PollingState<T> {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(enabled);
  const mountedRef = useRef(true);
  const fnRef = useRef(fn);

  // The effect below fetches on mount without setting `loading` itself, so
  // a new schedule starts the loading state during render instead.
  const schedule = enabled ? intervalMs : null;
  const [prevSchedule, setPrevSchedule] = useState(schedule);
  if (prevSchedule !== schedule) {
    setPrevSchedule(schedule);
    if (schedule !== null) setLoading(true);
  }

  useEffect(() => {
    fnRef.current = fn;
  });

  const poll = useCallback(async (): Promise<void> => {
    try {
      const v = await fnRef.current();
      if (mountedRef.current) {
        setValue(v);
        setError(null);
      }
    } catch (err: unknown) {
      if (mountedRef.current) setError(err as Error);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    await poll();
  }, [poll]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }
    void poll();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [enabled, intervalMs, poll, refresh]);

  return { value, error, loading, refresh };
}
