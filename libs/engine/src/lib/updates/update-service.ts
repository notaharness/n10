import { newerRelease, UpdateCheckError } from '@n10/core';
import type { RegistryVersion, UpdateCache } from '@n10/core';
import type {
  UpdateInstallation,
  UpdateService,
  UpdateSnapshot,
  UpdateStore,
} from './update-types.js';

const DAY = 24 * 60 * 60 * 1000;
const cacheKey = (cache: UpdateCache) =>
  JSON.stringify(cache, Object.keys(cache).sort());
interface Options {
  installation: UpdateInstallation;
  store: UpdateStore;
  resolveInstallation?: () => Promise<UpdateInstallation>;
  read: (
    previous: RegistryVersion | undefined,
    signal: AbortSignal
  ) => Promise<RegistryVersion>;
  now?: () => number;
  random?: () => number;
}

/** One check owner per shell, independent of repository selection and UI lifetime. */
export function createUpdateService(options: Options): UpdateService {
  const { store, read } = options;
  let installation = options.installation;
  const now = options.now ?? Date.now;
  // Packaged distribution gets its own GitHub provider in the packaging stack.
  let enabled =
    installation.kind === 'npm-global' || installation.kind === 'npm-local';
  let cache: UpdateCache = enabled ? store.readCache() : {};
  let observedCache = cacheKey(cache);
  let snapshot: UpdateSnapshot = {
    installation,
    preferences: store.readPreferences(),
    checking: false,
    availableVersion: null,
    checkedAt: cache.checkedAt ?? null,
    retryAt: cache.retryAt ?? null,
    error: cache.error ?? null,
    command: null,
    releaseNotesUrl: null,
  };
  const listeners = new Set<() => void>();
  let pending: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  function publish(patch: Partial<UpdateSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }
  function cacheView() {
    const version =
      cache.version && newerRelease(cache.version, installation.version)
        ? cache.version
        : null;
    return {
      availableVersion: version,
      command:
        version && installation.kind === 'npm-global'
          ? `npm i -g @notaharness/n10@${version}`
          : null,
      checkedAt: cache.checkedAt ?? null,
      retryAt: cache.retryAt ?? null,
      releaseNotesUrl: version
        ? `https://github.com/notaharness/n10/releases/tag/v${encodeURIComponent(
            version
          )}`
        : null,
    };
  }
  snapshot = { ...snapshot, ...cacheView() };

  function reloadPreferences() {
    const preferences = store.readPreferences();
    if (
      preferences.channel !== snapshot.preferences.channel ||
      preferences.automatic !== snapshot.preferences.automatic
    )
      publish({ preferences });
  }
  function reloadCache() {
    if (!enabled || pending) return;
    const saved = store.readCache();
    const key = cacheKey(saved);
    if (key === observedCache) return;
    observedCache = key;
    cache = saved;
    publish({ ...cacheView(), error: cache.error ?? null });
  }
  function persistCache() {
    try {
      store.writeCache(cache);
      observedCache = cacheKey(cache);
    } catch {
      publish({
        error:
          'Could not save the update check. Check your ~/.n10 permissions.',
      });
    }
  }
  async function perform(signal: AbortSignal) {
    publish({ checking: true, error: null });
    try {
      const previous = cache.version
        ? { version: cache.version, etag: cache.etag }
        : undefined;
      const result = await read(previous, signal);
      if (signal.aborted) return;
      cache = {
        ...result,
        checkedAt: now(),
        nextCheckAt:
          now() + DAY + (options.random ?? Math.random)() * 60 * 60 * 1000,
        failures: 0,
      };
      publish(cacheView());
      persistCache();
    } catch (error) {
      if (signal.aborted) return;
      const failures = Math.min((cache.failures ?? 0) + 1, 8);
      const retryAt = Math.max(
        now() + Math.min(DAY, 15 * 60 * 1000 * 2 ** (failures - 1)),
        error instanceof UpdateCheckError ? error.retryAt : 0
      );
      const message =
        error instanceof UpdateCheckError
          ? error.message
          : 'Could not check for updates. Check your connection and try again.';
      cache = {
        ...cache,
        nextCheckAt: retryAt,
        retryAt: error instanceof UpdateCheckError ? retryAt : undefined,
        failures,
        error: message,
      };
      publish({ ...cacheView(), error: message });
      persistCache();
    } finally {
      publish({ checking: false });
    }
  }
  function check() {
    reloadPreferences();
    if (pending) return pending;
    reloadCache();
    // Explicit checks bypass freshness, but not a server/error retry deadline.
    if (!enabled || (cache.retryAt ?? 0) > now()) return Promise.resolve();
    controller = new AbortController();
    pending = perform(controller.signal).finally(() => {
      pending = undefined;
    });
    return pending;
  }
  function tick() {
    if (!running) return;
    reloadPreferences();
    reloadCache();
    const due = cache.retryAt ?? cache.nextCheckAt ?? 0;
    if (enabled && snapshot.preferences.automatic && now() >= due) {
      // check settles failures into the snapshot. Keep a rejected subscriber from becoming unhandled.
      check().catch(() => publish({ error: 'Could not check for updates.' }));
    }
    timer = setTimeout(tick, 30_000);
    timer.unref();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check,
    reloadPreferences,
    setPreferences(patch) {
      if (
        patch.channel !== undefined &&
        patch.channel !== 'preview' &&
        patch.channel !== 'stable'
      )
        throw new Error('Unknown release channel.');
      if (patch.automatic !== undefined && typeof patch.automatic !== 'boolean')
        throw new Error('Invalid automatic update preference.');
      const preferences = { ...store.readPreferences(), ...patch };
      store.writePreferences(preferences);
      publish({ preferences });
    },
    start() {
      if (running) return;
      running = true;
      if (installation.kind === 'unknown' && options.resolveInstallation) {
        options
          .resolveInstallation()
          .then((resolved) => {
            if (!running) return;
            installation = resolved;
            enabled =
              resolved.kind === 'npm-global' || resolved.kind === 'npm-local';
            cache = enabled ? store.readCache() : {};
            observedCache = cacheKey(cache);
            publish({
              installation,
              ...cacheView(),
              error: cache.error ?? null,
            });
          })
          // The resolver settles failures into an installation classification.
          .catch(() => undefined);
      }
      timer = setTimeout(tick, 2000);
      timer.unref();
    },
    stop() {
      running = false;
      clearTimeout(timer);
      controller?.abort();
    },
  };
}
