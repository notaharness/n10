import { useTerminalDimensions } from './hooks/useTerminalDimensions.js';
import { useState } from 'react';
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
  applySessionBackend,
  closeSessionBackend,
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

/** Detach every terminal client; sessions this process owns end. */
function releaseSessions(): void {
  killAll();
  closeSessionBackend();
}

// ── App ────────────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const { sync } = useEngine();
  const { flash } = useToastActions();
  // Give manual operations and automatic removals one shared grace period.
  // Ink unmounts the UI; the entry point must also detach PTY clients and exit.
  const handleExit = () => {
    void (async () => {
      flash(
        'Closing n10 — waiting up to 3 seconds for active operations…',
        'info'
      );
      await waitForExit(() => sync.stop(), settlePendingRuns, EXIT_GRACE_MS);
      releaseSessions();
      exit();
      process.exit(0);
    })();
  };
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
  );
}

// ── Entry point ────────────────────────────────────────────────────

/** `n10 --tui [dir]`: `args` follow `--tui`. */
export async function runTui(args: string[]): Promise<void> {
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
    releaseSessions();
    restoreWindowTitle();
  });
  process.on('SIGINT', () => {
    releaseSessions();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    releaseSessions();
    process.exit(0);
  });

  // Resolve the requirement before rendering so missing tmux is actionable.
  await probeTmuxAvailability();
  try {
    await applySessionBackend();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  let repo;
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

  render(
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
                          <App />
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
