import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import type { N10HostApi, RepoInfo } from '../host/contract.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { TabDragProvider } from './components/editor/TabStrip.js';
import { RevokeMachineDialog } from './components/machines/RevokeMachineDialog.js';
import { Toaster } from './components/ui/sonner.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import {
  keys,
  queryClient,
  resetRepoScopedCache,
} from './lib/data/query-keys.js';
import { useRepoGate } from './lib/data/queries.js';
import { useFleet } from './lib/fleet/fleet-context.js';
import { FleetProvider } from './lib/fleet/fleet-provider.js';
import { errorMessage } from './lib/utils.js';
import { RepoOpen } from './screens/RepoOpen.js';
import { Workspace } from './screens/Workspace.js';
import { PrewarmProvider } from './lib/tabs/prewarm.js';
import { TabViewsHost } from './lib/tabs/tab-views.js';
import { TabsProvider } from './lib/tabs/tabs.js';
import { useRepoFollowsTabs } from './lib/tabs/use-repo-follows-tabs.js';

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

  /** Adopt a repository the host has already switched to. Opening it
   *  put it on the recents list, with its colour if it is new there. */
  const adoptRepo = useCallback(
    (r: RepoInfo) => {
      resetRepoScopedCache(qc);
      qc.setQueryData(keys.repo, r);
      void qc.invalidateQueries({ queryKey: keys.recents });
    },
    [qc]
  );

  /** Open a repository in place, reporting whether it worked. */
  const openRepoAsync = useCallback(
    async (cwd: string): Promise<boolean> => {
      try {
        adoptRepo(await window.n10.openRepo(cwd));
        return true;
      } catch (err: unknown) {
        toast.error(errorMessage(err));
        return false;
      }
    },
    [adoptRepo]
  );

  const openRepo = useCallback(
    (cwd: string) => void openRepoAsync(cwd),
    [openRepoAsync]
  );

  // A tab from another repository is shown by opening that repository.
  useRepoFollowsTabs(repo?.cwd ?? null, openRepoAsync);

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
        key={repo.cwd}
        repo={repo}
        onSwitchRepo={() => qc.setQueryData(keys.repo, null)}
        onOpenRepo={openRepo}
        onPickRepoFolder={pickRepoFolder}
      />
    </ErrorBoundary>
  );
}
