import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import type { N10HostApi, RepoInfo } from '../host/contract.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { TabDragProvider } from './components/editor/TabStrip.js';
import { RevokeMachineDialog } from './components/machines/RevokeMachineDialog.js';
import { Toaster } from './components/ui/sonner.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import { keys, queryClient } from './lib/data/query-keys.js';
import { useRepoGate } from './lib/data/queries.js';
import { repoShown, switchStarted } from './lib/data/repo-switch.js';
import { useFleet } from './lib/fleet/fleet-context.js';
import { FleetProvider } from './lib/fleet/fleet-provider.js';
import { errorMessage } from './lib/utils.js';
import { RepoOpen } from './screens/RepoOpen.js';
import { Workspace } from './screens/Workspace.js';
import { PrewarmProvider } from './lib/tabs/prewarm.js';
import { TabViewsHost } from './lib/tabs/tab-views.js';
import { TabsProvider, useTabs } from './lib/tabs/tabs.js';
import { useRepoFollowsTabs } from './lib/tabs/use-repo-follows-tabs.js';
import { useTabSwitching } from './lib/tabs/use-tab-switching.js';

declare global {
  interface Window {
    n10: N10HostApi;
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* Above the gate on purpose: the tab strip spans repositories,
            so switching repos must not unmount the tabs of the one being
            left — their agents keep running and stay in the strip — nor
            drop a drag the press that switched them began. */}
        <TabsProvider>
          <TabViewsHost>
            <PrewarmProvider>
              <TabDragProvider>
                <FleetProvider>
                  <Gate />
                  <RevocationDialog />
                </FleetProvider>
              </TabDragProvider>
            </PrewarmProvider>
          </TabViewsHost>
        </TabsProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** The one fleet flow in a modal (beam-fleet-ux.md §1): above the
 *  gate, so switching repositories or hiding the sidebar cannot drop a
 *  revocation waiting on its passkey. */
function RevocationDialog() {
  const { target } = useFleet().revocation;
  return target ? <RevokeMachineDialog machine={target} /> : null;
}

function Gate() {
  const qc = useQueryClient();
  const { data: repo, isPending } = useRepoGate();
  const { repoOpened } = useTabs();
  const shownCwd = repo?.cwd;
  // Committed, so on screen: what a failed switch refused may go again.
  useEffect(() => {
    if (shownCwd) repoShown(shownCwd);
  }, [shownCwd]);

  /**
   * Adopt a repository the host has already switched to. Every other
   * repository's cache stays; this one's is read again behind what it
   * shows. Pending writes go: a worktree removal pending in the
   * repository left would otherwise hide a same-named row in this one.
   * Opening it put it on the recents list, with its colour if it is new
   * there. Its tab comes to the front, if one of another repository
   * is: opened from the picker or the palette, it is what was asked for.
   */
  const adoptRepo = useCallback(
    (r: RepoInfo) => {
      qc.getMutationCache().clear();
      qc.setQueryData(keys.repo, r);
      qc.setQueryData(keys.repoInfo(r.cwd), r);
      repoOpened(r.cwd);
      // Refetches settle into each query's own state; neither rejects.
      void qc.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[1] === r.cwd,
      });
      void qc.invalidateQueries({ queryKey: keys.recents });
    },
    [qc, repoOpened]
  );

  /**
   * Open a repository in place, reporting whether it worked. One shown
   * before this run is shown at once from what was cached for it, while
   * the host opens it; the answer then refreshes it. Writes wait for
   * that answer (`repo-switch.ts`). A failed open returns to the
   * repository that was open, and leaves the tab that asked for it in
   * front, saying so.
   */
  const openRepoAsync = useCallback(
    async (cwd: string): Promise<boolean> => {
      const previous = qc.getQueryData<RepoInfo | null>(keys.repo);
      const cached = qc.getQueryData<RepoInfo>(keys.repoInfo(cwd));
      if (cached) qc.setQueryData(keys.repo, cached);
      const open = window.n10.openRepo(cwd);
      if (cached) switchStarted(open, previous?.cwd ?? null);
      try {
        adoptRepo(await open);
        return true;
      } catch (err: unknown) {
        if (cached) qc.setQueryData(keys.repo, previous ?? null);
        // What was held for it may be fresh, from before it moved: read
        // it again, so its tabs say it cannot be opened.
        void qc.invalidateQueries({ queryKey: keys.repoInfo(cwd) });
        toast.error(errorMessage(err));
        return false;
      }
    },
    [qc, adoptRepo]
  );

  const openRepo = useCallback(
    (cwd: string) => void openRepoAsync(cwd),
    [openRepoAsync]
  );

  // A tab from another repository is shown by opening that repository.
  useRepoFollowsTabs(repo?.cwd ?? null, openRepoAsync);
  // Above the workspace, which the repository picker unmounts: a walk
  // onto another repository's tab is what switches repository. Off on
  // the picker and while connecting, where no strip is shown.
  useTabSwitching(Boolean(repo));

  const pickRepoFolder = useCallback(() => {
    window.n10
      .selectRepoDirectory()
      .then((dir) => {
        if (dir) openRepo(dir);
      })
      .catch((err: unknown) => toast.error(errorMessage(err)));
  }, [openRepo]);

  if (isPending) {
    return (
      <main className="flex h-screen items-center justify-center bg-background">
        <p className="animate-pulse text-sm text-muted-foreground">
          Connecting to host…
        </p>
      </main>
    );
  }

  if (!repo) {
    return <RepoOpen onOpened={adoptRepo} />;
  }

  // Below the providers, so a workspace that fails to render leaves the
  // open tabs, toasts and a pending revocation in place, and Try again
  // remounts it with them.
  return (
    <ErrorBoundary
      resetKey={repo.cwd}
      label="This repository's workspace failed to render."
    >
      <Workspace
        repo={repo}
        onSwitchRepo={() => qc.setQueryData(keys.repo, null)}
        onOpenRepo={openRepo}
        onPickRepoFolder={pickRepoFolder}
      />
    </ErrorBoundary>
  );
}
