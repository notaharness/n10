import { useCallback, useEffect, useRef } from 'react';
import type { BranchPrMap } from '@n10/vcs-core';
import { logError } from '@n10/logger';
import { useConfig } from '../context/ConfigContext.js';
import { useToastActions } from '../context/ToastContext.js';
import { usePolling } from './usePolling.js';

export function usePrData(refreshInterval = 60000) {
  const { config, provider } = useConfig();
  const { flash } = useToastActions();
  const { vendorAuth, vendorProject, prPollInterval } = config;

  const enabled =
    provider != null && provider.isConfigured(vendorAuth, vendorProject);

  // Set by `refresh` below, consumed by the fetch that answers it.
  const forgetCacheRef = useRef(false);

  const fetchPrs = useCallback(async (): Promise<BranchPrMap> => {
    if (!enabled || !provider) return {};
    if (forgetCacheRef.current) {
      forgetCacheRef.current = false;
      provider.forgetPullRequestCache?.(vendorProject);
    }
    try {
      return await provider.fetchPullRequests(vendorAuth, vendorProject);
    } catch (err: unknown) {
      logError(`fetchPullRequests [${provider.id}]`, err as Error);
      throw err;
    }
  }, [enabled, provider, vendorAuth, vendorProject]);

  const polling = usePolling<BranchPrMap>(
    fetchPrs,
    prPollInterval ?? refreshInterval,
    enabled
  );

  // Toast on new error messages only — the poll fires the same
  // callback every interval, so without this guard a persistent
  // failure would re-flash forever.
  const lastFlashedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const message = polling.error?.message ?? null;
    if (message === null) {
      lastFlashedErrorRef.current = null;
      return;
    }
    if (lastFlashedErrorRef.current !== message) {
      lastFlashedErrorRef.current = message;
      flash(`PR error: ${message}`, 'error');
    }
  }, [polling.error, flash]);

  /**
   * The user asked, so go and look.
   *
   * A provider may hold per-row answers well past one response — Azure
   * remembers a settled CI verdict for ten minutes so a poll does not
   * spend a request per row on it — and answering a keypress from
   * memory is what makes the key look broken. The desktop's refresh
   * does the same thing through its host (`services/sidebar.ts`).
   *
   * The provider forgets when the answering fetch starts, not now: a
   * poll already in flight finishes first and would write its answers
   * straight back.
   */
  const refresh = useCallback(() => {
    forgetCacheRef.current = true;
    return polling.refresh();
  }, [polling]);

  return {
    prMap: polling.value ?? {},
    loading: polling.loading,
    error: polling.error?.message ?? null,
    refresh,
  };
}
