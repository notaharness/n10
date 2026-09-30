import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useConfig } from '../context/ConfigContext.js';
import { useEngine } from '../context/EngineContext.js';
import { useToastActions } from '../context/ToastContext.js';

/**
 * The open repository's pull request list, as the engine holds it.
 *
 * Reading, scheduling, joining and the refresh's provider-memo reset
 * are the engine's (`@n10/engine` `pull-request-list.ts`), shared with
 * the desktop. What is left here is the TUI's: holding a watch while
 * mounted, and toasting an error.
 */
export function usePrData() {
  const { pullRequests, repo } = useEngine();
  const { config } = useConfig();
  const { flash } = useToastActions();

  const subscribe = useCallback(
    (onChange: () => void) =>
      pullRequests.subscribe((cwd) => {
        if (cwd === repo) onChange();
      }),
    [pullRequests, repo]
  );
  const getSnapshot = useCallback(
    () => pullRequests.getSnapshot(repo),
    [pullRequests, repo]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  // Taken again whenever the config changes: the engine resolves the
  // provider from the persisted config, and a new provider, project or
  // credentials is a new scope, to be read now rather than an interval
  // later. An unchanged scope is fresh, so re-taking costs nothing.
  useEffect(() => pullRequests.watch(repo), [pullRequests, repo, config]);

  // Toast on new error messages only — every poll that fails reports
  // the same error, and a persistent failure must not re-flash forever.
  const lastFlashedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const message = snapshot.error;
    if (message === null) {
      lastFlashedErrorRef.current = null;
      return;
    }
    if (lastFlashedErrorRef.current !== message) {
      lastFlashedErrorRef.current = message;
      flash(`PR error: ${message}`, 'error');
    }
  }, [snapshot.error, flash]);

  /** The user asked, so go and look — the provider forgets its per-row
   *  answers when this refresh's own request starts. */
  const refresh = useCallback(async (): Promise<void> => {
    await pullRequests.refresh(repo);
  }, [pullRequests, repo]);

  return {
    prMap: snapshot.prMap,
    loading: snapshot.refreshing,
    error: snapshot.error,
    refresh,
  };
}
