import { UpdatesContext } from './hooks/useUpdates.js';
import type { UpdateService, NpmUpdatePlan } from '@n10/engine/contract';
import { createInstalledUpdates, type RepositoryHandle } from '@n10/engine';
import { useTerminalDimensions } from './hooks/useTerminalDimensions.js';
import { useState, useCallback, useMemo } from 'react';
import { render, Box, useApp } from 'ink';
import type { VcsProvider } from '@n10/vcs-core';
import { azureDevOpsProvider } from '@n10/vcs-azure-devops';
import { githubProvider } from '@n10/vcs-github';
import { DeleteConfirmModal } from './components/DeleteConfirmModal.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import {
  createPullRequestList,
  createRepositoryService,
  createRemoteSync,
} from '@n10/engine';
import {
  settlePendingRuns,
  ConfigProvider,
  EngineProvider,
  useConfig,
  useEngine,
  KeybindProvider,
  NavProvider,
  useNavState,
  AsyncOpsProvider,
  PlanProvider,
  LayoutProvider,
  useLayout,
  ModalProvider,
  useDeleteConfirmState,
  SessionProvider,
  SidebarProvider,
  ToastProvider,
  useToastActions,
} from '@n10/app-core';
import {
  killAll,
  runNpmUpdate,
  relaunchNpmApp,
  applySessionBackend,
  probeTmuxAvailability,
  resetRepoRoot,
} from '@n10/core';
import {
  repoTitle,
  setWindowTitle,
  restoreWindowTitle,
} from './utils/window-title.js';
import { waitForExit } from './utils/wait-for-exit.js';
import { MainTab } from './screens/main/MainTab.js';

// ── Provider registry ──────────────────────────────────────────────

const providers: VcsProvider[] = [azureDevOpsProvider, githubProvider];

// The same pull request list the desktop host runs, in this process.
const pullRequests = createPullRequestList({ providers });

const EXIT_GRACE_MS = 3_000;

// ── App ────────────────────────────────────────────────────────────

function App({
  updates,
  restart,
}: {
  updates: UpdateService;
  restart: (plan: NpmUpdatePlan) => Promise<void>;
}) {
  const { exit } = useApp();
  const { sync } = useEngine();
  const { flash } = useToastActions();
  // Give manual operations and automatic removals one shared grace period.
  // Ink unmounts the UI; the entry point must also detach PTY clients and exit.
  const handleExit = useCallback(
    (command?: string) => {
      void (async () => {
        flash(
          'Closing n10 — waiting up to 3 seconds for active operations…',
          'info'
        );
        await waitForExit(() => sync.stop(), settlePendingRuns, EXIT_GRACE_MS);
        killAll();
        exit();
        if (command) console.log(`To update, run: ${command}`);
        process.exit(0);
      })();
    },
    [exit, sync, flash]
  );
  const updatesContext = useMemo(
    () => ({ service: updates, quit: handleExit, restart }),
    [updates, handleExit, restart]
  );
  const { config, provider, vcsConfigured } = useConfig();
  const nav = useNavState();
  const deleteConfirm = useDeleteConfirmState();
  const { termRows } = useLayout();
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  const showOnboarding =
    !onboardingComplete && !!config.vendor && !!provider && !vcsConfigured;

  const terminalFocused = nav.focus === 'terminal';

  if (showOnboarding) {
    return (
      <Box flexDirection="column" height={termRows}>
        <OnboardingWizard onComplete={() => setOnboardingComplete(true)} />
      </Box>
    );
  }

  return (
    <UpdatesContext.Provider value={updatesContext}>
      <Box flexDirection="column" height={termRows}>
        <Box flexGrow={1}>
          <MainTab
            terminalFocused={terminalFocused}
            showOnboarding={showOnboarding}
            exit={handleExit}
          />
        </Box>
        {deleteConfirm.confirmDelete && (
          <DeleteConfirmModal
            branch={deleteConfirm.confirmDelete.branch}
            reason={deleteConfirm.confirmDelete.reason}
            mode={deleteConfirm.confirmDelete.mode}
            confirmInput={deleteConfirm.confirmInput}
          />
        )}
      </Box>
    </UpdatesContext.Provider>
  );
}

// ── Entry point ────────────────────────────────────────────────────

/** `n10 --tui [dir]`: `args` follow `--tui`. */
export async function runTui(args: string[], packageRoot = ''): Promise<void> {
  const updates = createInstalledUpdates(packageRoot, false, 'tui');
  updates.start();
  const targetDir = args.find((a) => !a.startsWith('--'));
  if (targetDir) {
    process.chdir(targetDir);
  }

  // Name the tab after the repo, so a terminal full of n10s is legible.
  // Skip the git lookup entirely when there's no TTY to title (CI, pipes).
  if (process.stdout.isTTY) {
    setWindowTitle(repoTitle());
  }

  process.on('exit', () => {
    killAll();
    restoreWindowTitle();
  });
  process.on('SIGINT', () => {
    killAll();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    killAll();
    process.exit(0);
  });

  // Resolve the requirement before rendering so missing tmux is actionable.
  await probeTmuxAvailability();
  try {
    applySessionBackend();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  let repo: RepositoryHandle;
  try {
    repo = createRepositoryService({ providers, pullRequests }).open(
      process.cwd()
    );
    process.chdir(repo.cwd);
    resetRepoRoot();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const worktrees = repo.worktrees;
  const sync = createRemoteSync({
    config: repo.config,
    pullRequests,
    worktrees,
  });

  async function restart(plan: NpmUpdatePlan) {
    await Promise.all([sync.stop(), settlePendingRuns()]);
    updates.stop();
    instance.unmount();
    await instance.waitUntilExit();
    // Removing Ink/data listeners alone does not pause a flowing stream.
    // The foreground npm process and replacement TUI must own stdin.
    process.stdin.pause();
    repo.sessions.park();
    repo.reviews.park();
    pullRequests.dispose();
    killAll();
    try {
      console.log(
        `Updating n10 to ${plan.version}… Your tmux agents keep running.`
      );
      const result = await runNpmUpdate(plan);
      console.log(result.message);
      if (result.status === 'failed')
        console.error(`npm logs: ${result.logPath}`);
      process.exit(await relaunchNpmApp(plan.root, 'tui'));
    } catch (error) {
      console.error('n10: update failed:', error);
      console.error(
        `Run npm i -g @notaharness/n10@${plan.version}, then n10 --tui.`
      );
      process.exit(1);
    }
  }

  const instance = render(
    <ConfigProvider service={repo.config}>
      <EngineProvider
        pullRequests={pullRequests}
        repo={repo.cwd}
        sync={sync}
        worktrees={worktrees}
        reviews={repo.reviews}
        sessions={repo.sessions}
      >
        <KeybindProvider>
          <LayoutProvider useDimensions={useTerminalDimensions}>
            <NavProvider>
              <AsyncOpsProvider>
                <PlanProvider>
                  <ModalProvider>
                    <ToastProvider>
                      <SessionProvider>
                        <SidebarProvider>
                          <App updates={updates} restart={restart} />
                        </SidebarProvider>
                      </SessionProvider>
                    </ToastProvider>
                  </ModalProvider>
                </PlanProvider>
              </AsyncOpsProvider>
            </NavProvider>
          </LayoutProvider>
        </KeybindProvider>
      </EngineProvider>
    </ConfigProvider>
  );
}
