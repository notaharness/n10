import { logError } from '@n10/logger';

export interface ReadSnapshot<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
}

export interface ReadResource<T> {
  getSnapshot(): ReadSnapshot<T>;
  subscribe(listener: () => void): () => void;
  /** Reads never reject; a failed read retains data from the same scope. */
  read(force?: boolean): Promise<ReadSnapshot<T>>;
  /** Forget data across an identity change; refresh observed resources. */
  reset(): void;
  /** Expire same-scope data without dropping the last successful answer. */
  invalidate(): void;
  /** Apply a confirmed mutation only to the snapshot it was based on. */
  patch(base: ReadSnapshot<T>, update: (data: T) => T): void;
  dispose(): void;
  observed(): boolean;
}

/** A bounded read lane: ordinary readers join, forced readers share one follow-up. */
export function createReadResource<T>(
  load: () => Promise<T>,
  ttl: number
): ReadResource<T> {
  let snapshot: ReadSnapshot<T> = {
    data: null,
    loading: false,
    error: null,
    fetchedAt: null,
  };
  let attemptedAt: number | null = null;
  let active: Promise<ReadSnapshot<T>> | undefined;
  let queued = false;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  function publish(patch: Partial<ReadSnapshot<T>>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        logError('review observer', error);
      }
    }
  }
  async function pass() {
    const gen = generation;
    publish({ loading: true, error: null });
    try {
      const data = await load();
      if (disposed || gen !== generation) return;
      attemptedAt = Date.now();
      publish({ data, fetchedAt: attemptedAt });
    } catch (error) {
      if (disposed || gen !== generation) return;
      attemptedAt = Date.now();
      publish({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (!disposed && gen === generation) publish({ loading: false });
    }
  }
  async function drain(): Promise<ReadSnapshot<T>> {
    do {
      queued = false;
      await pass();
    } while (queued && !disposed);
    active = undefined;
    return snapshot;
  }
  function read(force = false): Promise<ReadSnapshot<T>> {
    if (disposed) return Promise.resolve(snapshot);
    if (active) {
      if (force) queued = true;
      return active;
    }
    if (!force && attemptedAt !== null && Date.now() - attemptedAt < ttl)
      return Promise.resolve(snapshot);
    active = Promise.resolve().then(drain);
    publish({ loading: true });
    return active;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    observed: () => listeners.size > 0,
    read,
    patch(base, update) {
      if (!disposed && snapshot === base && snapshot.data !== null)
        publish({ data: update(snapshot.data) });
    },
    invalidate() {
      generation += 1;
      attemptedAt = null;
      publish({ loading: false, error: null });
      if (listeners.size || active) void read(true);
    },
    reset() {
      generation += 1;
      attemptedAt = null;
      publish({ data: null, loading: false, error: null, fetchedAt: null });
      if (listeners.size || active) void read(true);
    },
    dispose() {
      disposed = true;
      generation += 1;
      queued = false;
      listeners.clear();
    },
  };
}

/** An RPC adapter can turn a failed snapshot into its transport's error. */
export async function readResourceValue<T>(
  resource: ReadResource<T>,
  force = false
): Promise<T> {
  const snapshot = await resource.read(force);
  if (snapshot.error) throw new Error(snapshot.error);
  if (snapshot.data === null)
    throw new Error('The review read is no longer active');
  return snapshot.data;
}
