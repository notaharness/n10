import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { PullRequestList, RemoteSync, WorktreeService } from '@n10/engine';

/**
 * The engine services a shell created, and the repository this
 * frontend shows. The shell owns their lifetime; hooks below only
 * observe them and ask them for things.
 */
export interface EngineContextValue {
  pullRequests: PullRequestList;
  repo: string;
  sync: RemoteSync;
  worktrees: WorktreeService;
}

const EngineContext = createContext<EngineContextValue | null>(null);

export function EngineProvider({
  pullRequests,
  repo,
  sync,
  worktrees,
  children,
}: EngineContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ pullRequests, repo, sync, worktrees }),
    [pullRequests, repo, sync, worktrees]
  );
  return (
    <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
  );
}

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used within EngineProvider');
  return ctx;
}
