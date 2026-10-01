import type { WorktreeService, SessionService } from '@n10/engine/contract';
import { useEngine } from './EngineContext.js';
import { createContext, useContext, useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import type {
  PullRequestInfo,
  CategorizedReviews,
  BranchPrMap,
} from '@n10/vcs-core';
import {
  findOrphanPrs,
  categorizeReviews as categorizePrReviews,
  buildSessionPrMap,
} from '@n10/core/ui';
import { setOperationErrorHandler } from '../hooks/useAsyncOperation.js';
import { useSessionManager } from '../hooks/useSessionManager.js';
import { usePrData } from '../hooks/usePrData.js';
import { useRemoteSync } from '../hooks/useRemoteSync.js';
import { useConfig } from './ConfigContext.js';
import { useBranchPickerActions } from './ModalContext.js';
import { useToastActions } from './ToastContext.js';
import type { ToastVariant } from './ToastContext.js';
import type { AgentSession } from '@n10/core';
import { sortSessionsByPrId } from '@n10/core/ui';

// ── Data context (consumed by SidebarProvider, changes on data refresh) ──

export interface SessionDataContextValue {
  sessions: AgentSession[];
  sortedSessions: AgentSession[];
  prMap: BranchPrMap;
  prError: string | null;
  orphanPrs: PullRequestInfo[];
  categorizedReviews: CategorizedReviews;
  sessionPrMap: Map<string, PullRequestInfo>;
  mergedBranches: Set<string>;
  conflictCounts: Map<string, number>;
  conflictsLoading: boolean;
  lastSynced: number;
}

// ── Actions context (consumed by input handlers) ──

export interface SessionActionsContextValue {
  /**
   * Push a transient notification toast. Defaults to the `info` variant.
   * Internally delegates to ToastContext — every call renders in the
   * top-right toast stack.
   */
  flashStatus: (msg: string, variant?: ToastVariant) => void;
  worktrees: WorktreeService;
  commands: SessionService;
  refreshSessions: () => Promise<AgentSession[]>;
  refreshPr: () => Promise<void>;
  triggerSync: () => Promise<void>;
}

const SessionDataContext = createContext<SessionDataContextValue | null>(null);
const SessionActionsContext = createContext<SessionActionsContextValue | null>(
  null
);

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { config, provider } = useConfig();
  const { setBranches } = useBranchPickerActions();
  const { flash } = useToastActions();
  const { worktrees, sessions: commands } = useEngine();

  const sessionMgr = useSessionManager(setBranches);

  const { prMap, error: prError, refresh: refreshPr } = usePrData();
  const {
    lastSynced,
    triggerSync,
    mergedBranches,
    conflictCounts,
    isSyncing: conflictsLoading,
  } = useRemoteSync();

  // An async op has no caller to report to — every `run` is fired and
  // forgotten — so a failure lands on the toast rail. Without this a
  // git call that rejects (no upstream, locked index, unreachable
  // remote) was an unhandled rejection, which ends the process.
  useEffect(
    () =>
      setOperationErrorHandler((name, error) =>
        flash(`${name} failed: ${describeError(error)}`, 'error')
      ),
    [flash]
  );

  const orphanPrs = useMemo(() => {
    if (!provider) return [];
    const checkedOut = new Set(
      sessionMgr.sessions.flatMap((s) => (s.branch ? [s.branch] : []))
    );
    return findOrphanPrs(prMap, checkedOut, config, provider);
  }, [prMap, sessionMgr.sessions, config, provider]);

  const categorizedReviews = useMemo((): CategorizedReviews => {
    if (!provider)
      return { needsReview: [], waitingForAuthor: [], approvedByYou: [] };
    return categorizePrReviews(prMap, config, provider);
  }, [prMap, config, provider]);

  const sessionPrMap = useMemo(
    () => buildSessionPrMap(prMap, sessionMgr.sessions),
    [prMap, sessionMgr.sessions]
  );

  const sortedSessions = useMemo(
    () => sortSessionsByPrId(sessionMgr.sessions, sessionPrMap),
    [sessionMgr.sessions, sessionPrMap]
  );

  const dataValue = useMemo<SessionDataContextValue>(
    () => ({
      sessions: sessionMgr.sessions,
      sortedSessions,
      prMap,
      prError,
      orphanPrs,
      categorizedReviews,
      sessionPrMap,
      mergedBranches,
      conflictCounts,
      conflictsLoading,
      lastSynced,
    }),
    [
      sessionMgr.sessions,
      sortedSessions,
      prMap,
      prError,
      orphanPrs,
      categorizedReviews,
      sessionPrMap,
      mergedBranches,
      conflictCounts,
      conflictsLoading,
      lastSynced,
    ]
  );

  const { refreshSessions } = sessionMgr;

  const actionsValue = useMemo<SessionActionsContextValue>(
    () => ({
      flashStatus: flash,
      refreshSessions,
      worktrees,
      commands,
      refreshPr,
      triggerSync,
    }),
    [flash, refreshSessions, worktrees, commands, refreshPr, triggerSync]
  );

  return (
    <SessionDataContext.Provider value={dataValue}>
      <SessionActionsContext.Provider value={actionsValue}>
        {children}
      </SessionActionsContext.Provider>
    </SessionDataContext.Provider>
  );
}

export function useSessionData(): SessionDataContextValue {
  const ctx = useContext(SessionDataContext);
  if (!ctx)
    throw new Error('useSessionData must be used within SessionProvider');
  return ctx;
}

export function useSessionActions(): SessionActionsContextValue {
  const ctx = useContext(SessionActionsContext);
  if (!ctx)
    throw new Error('useSessionActions must be used within SessionProvider');
  return ctx;
}
