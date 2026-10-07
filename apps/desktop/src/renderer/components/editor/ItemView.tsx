import { Loader2Icon, PlayIcon, TerminalIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  SessionSummary,
  SidebarItem,
  WorktreeResume,
} from '../../../host/contract.js';
import type { ItemTab } from '../../lib/tabs/tabs.js';
import { useRepo } from '../../lib/repo-context.js';
import { useAllBranches, useSessions } from '../../lib/data/queries.js';
import { useBranchSessionRail } from '../../lib/review/use-branch-session-rail.js';
import {
  itemBranch,
  itemHasWorktree,
  itemRunning,
  itemSessionName,
  liveSessionName,
} from '../../lib/sidebar/sidebar-model.js';
import {
  clearLaunchMenuRequest,
  useLaunchMenuRequested,
} from '../../lib/sidebar/launch-menu-request.js';
import {
  estimateTerminalGrid,
  paneTerminalGrid,
} from '../../lib/terminal-grid.js';
import { LaunchTerminalDialog } from '../review/LaunchTerminalDialog.js';
import { PrWorkspace } from './lazy-panes.js';
import { Button } from '../ui/button.js';
import { LaunchDialog, type LaunchChoice } from './LaunchDialog.js';
import { RemovedWorktreePane } from './RemovedWorktreePane.js';
import { ResumeWorktreePane } from './ResumeWorktreePane.js';
import { useItemLaunch } from './use-item-launch.js';

/**
 * One editor tab for a sidebar item.
 *   • A pull request → the review workspace (PrWorkspace): a rail of
 *     sessions and files beside a pane that swaps between the diff and
 *     a session's terminal. Launch and Stop live in the rail.
 *   • A bare worktree → its agent terminal, or a launch call-to-action.
 *
 * Every launch goes through the session menu (LaunchDialog) — it is
 * where the agent for this launch is chosen, whether or not the row has
 * a pull request.
 */

/**
 * A branch can hold two sidebar rows — the pull request, and the
 * worktree that actually owns the agent session. The tab may have been
 * opened from either, so both are folded together here and the pane
 * reads the live session regardless of which row it came from.
 */
function resolveItemState(
  item: SidebarItem,
  sessionRow: SidebarItem | undefined,
  aliveSessions: readonly SessionSummary[]
) {
  const rowSessionName =
    itemSessionName(item) ??
    (sessionRow ? itemSessionName(sessionRow) : undefined);
  return {
    sessionName: liveSessionName(rowSessionName, aliveSessions),
    running:
      itemRunning(item) || (sessionRow ? itemRunning(sessionRow) : false),
    hasWorktree: Boolean(rowSessionName) || itemHasWorktree(item),
    pr: item.pr ?? sessionRow?.pr,
  };
}

type ItemState = ReturnType<typeof resolveItemState>;

/**
 * The branch behind the tab and, once the item exists, what it has:
 * a worktree, a live session, a pull request.
 */
function useItemState(
  cwd: string,
  item: SidebarItem | undefined,
  items: SidebarItem[]
): { branch: string; state: ItemState | undefined } {
  const sessions = useSessions(cwd);
  const branch = item ? itemBranch(item) : '';
  const sessionRow = useMemo(
    () => items.find((i) => itemBranch(i) === branch && itemSessionName(i)),
    [items, branch]
  );
  const state = item
    ? resolveItemState(item, sessionRow, sessions.data ?? [])
    : undefined;
  return { branch, state };
}

function launchTarget(branch: string, state: ItemState | undefined) {
  return {
    branch,
    hasWorktree: state?.hasWorktree ?? false,
    pr: state?.pr,
  };
}

/**
 * Default branch for PR-less worktree diffs: main, falling back to
 * master (the host's ref resolver prefers origin/<name>).
 */
function useBaseBranch(cwd: string): string {
  const allBranches = useAllBranches(cwd);
  return useMemo(() => {
    const names = new Set(
      (allBranches.data ?? []).map((b) => b.replace(/^origin\//, ''))
    );
    return names.has('main') ? 'main' : 'master';
  }, [allBranches.data]);
}

/**
 * Whether the session menu is showing. Two things open it: the tab's
 * own Launch button, and a request from outside the tab — the sidebar
 * (Enter, double-click, "Launch agent…") or the palette after a fresh
 * checkout. A request is honored once the item exists, and copied into
 * the pane's own state then (see launch-menu-request.ts for why); a
 * tab the user has left must not pop the menu later, so inactive tabs
 * drop the request.
 *
 * `active` is the strip's own answer, not the deferred one the pane
 * body renders by: a request arrives in the same update that brings
 * the tab forward, and against the deferred value the pane would still
 * read as behind and drop it.
 */
function useLaunchMenu(branch: string, active: boolean, state?: ItemState) {
  const [own, setOwn] = useState(false);
  const hasItem = state !== undefined;
  const requested = useLaunchMenuRequested(branch);

  // The dialog portals to <body>, so an inactive-but-mounted
  // (visibility:hidden) pane would leave it floating over whichever
  // tab is active now — leaving the tab dismisses it.
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (!active) setOwn(false);
  }
  // Honoring a request makes the menu the pane's own, in the same
  // render the request is seen; the request itself is cleared after.
  if (requested && active && hasItem && !own) setOwn(true);
  useEffect(() => {
    if (requested && (!active || own)) clearLaunchMenuRequest(branch);
  }, [requested, active, own, branch]);

  const close = () => {
    setOwn(false);
    clearLaunchMenuRequest(branch);
  };
  return { open: own, show: () => setOwn(true), close };
}

function Preparing({ itemKey }: { itemKey: string }) {
  // The worktree is still being created (optimistic tab), or its item
  // re-keyed and the next sync has not caught up; show a quiet loading
  // state — the pane resolves itself on the next sidebar poll. A
  // removed worktree's tab does not land here: its agent keeps a row
  // while it runs, and discovery closes the tab once it has exited.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2Icon className="size-6 animate-spin" />
      <p className="text-sm">Preparing {itemKey.replace(/^[a-z]+:/, '')}…</p>
    </div>
  );
}

interface ItemViewProps {
  tab: ItemTab;
  item: SidebarItem | undefined;
  items: SidebarItem[];
  itemKey: string;
  /** Whether the strip has this tab in front, before the pane switch
   *  (deferred) catches up — what a session menu request goes by. */
  menuActive: boolean;
  onPin: () => void;
}

export function ItemView(props: ItemViewProps) {
  const { item } = props;
  // The checkout is gone and only its agent is left to show and stop.
  if (item?.kind === 'session' && item.session.worktreeRemoved)
    return <RemovedWorktreePane sessionName={item.session.name} />;
  return <WorktreeItemView {...props} />;
}

function shouldResumeWorktree(
  tab: ItemTab
): tab is ItemTab & { restore: WorktreeResume } {
  return !!tab.resumeRequired && !!tab.restore;
}

function resumePresentation(tab: ItemTab, branch: string) {
  return {
    title: tab.title ?? tab.branch ?? tab.itemKey,
    branch: tab.branch ?? branch,
  };
}

function terminalLaunchDialog(
  sessions: ReturnType<typeof useBranchSessionRail>,
  branch: string
) {
  const choice = sessions.choice;
  if (!choice) return null;
  return (
    <LaunchTerminalDialog
      branch={branch}
      defaultMachine={sessions.terminalMachine}
      busy={sessions.terminalBusy}
      remoteStep={choice.remoteStep}
      remoteError={choice.remoteError}
      onLaunch={choice.launchOn}
      onClose={choice.close}
    />
  );
}

function launchDialog(
  menu: ReturnType<typeof useLaunchMenu>,
  state: ItemState,
  branch: string,
  cwd: string,
  launch: ReturnType<typeof useItemLaunch>,
  onChoose: (choice: LaunchChoice) => void,
  onClose: () => void
) {
  if (!menu.open) return null;
  return (
    <LaunchDialog
      pr={state.pr}
      branch={branch}
      hasWorktree={state.hasWorktree}
      cwd={cwd}
      busy={launch.busy}
      remoteStep={launch.remoteStep}
      remoteError={launch.remoteError}
      onChoose={onChoose}
      onClose={onClose}
    />
  );
}

function WorktreeItemView({
  tab,
  item,
  items,
  itemKey,
  menuActive,
  onPin,
}: ItemViewProps) {
  const { repo } = useRepo();
  const paneRef = useRef<HTMLDivElement>(null);
  const { branch, state } = useItemState(repo.cwd, item, items);
  const baseBranch = useBaseBranch(repo.cwd);
  const menu = useLaunchMenu(branch, menuActive, state);

  // Measured off the pane the terminal will actually occupy, not off
  // the tab: the rail beside it is resizable, so no fraction of the tab
  // is the right answer for long. The terminal re-fits itself once it
  // mounts, but an agent paints its first frame at whatever size it was
  // spawned with, and that frame is the one the user sees.
  const estimateGrid = () => {
    const tab = paneRef.current;
    if (!tab) return {};
    const pane = tab.querySelector<HTMLElement>('[data-terminal-pane]');
    const measured = pane ? paneTerminalGrid(pane) : null;
    if (measured) return measured;
    // Launching on a branch with no worktree yet: the content pane does
    // not exist to measure (nor is it laid out), and the rail whose
    // width it excludes is not on screen either. A deliberately conservative fraction of the tab
    // is the least bad guess — too narrow costs a reflow, too wide
    // costs wrapped output — and the terminal corrects it either way
    // the moment it mounts.
    return estimateTerminalGrid(tab.getBoundingClientRect(), 0.6);
  };
  const launch = useItemLaunch(
    repo.cwd,
    launchTarget(branch, state),
    estimateGrid,
    menu.close
  );
  const { choose, busy, resetRemote } = launch;
  const sessions = useBranchSessionRail(
    repo.cwd,
    state?.pr?.sourceBranch ?? branch,
    estimateGrid
  );

  if (shouldResumeWorktree(tab)) {
    return (
      <ResumeWorktreePane
        {...resumePresentation(tab, branch)}
        repo={repo.cwd}
        restore={tab.restore}
        paneRef={paneRef}
        estimateGrid={estimateGrid}
      />
    );
  }

  if (!item || !state) return <Preparing itemKey={itemKey} />;
  const { sessionName, running, hasWorktree, pr } = state;

  const onLaunchClick = () => {
    onPin();
    menu.show();
  };
  // A remote launch leaves the dialog open to show its step, and to
  // keep the user's input intact on a named failure (ux-machines.md
  // §5) — closing here as eagerly as a local launch would lose both.
  // `useItemLaunch` closes it itself once the launch actually lands.
  const closeMenu = () => {
    resetRemote();
    menu.close();
  };
  const onChoose = (choice: LaunchChoice) => {
    onPin();
    if (!choice.machine) closeMenu();
    choose(choice);
  };
  const terminalDialog = terminalLaunchDialog(
    sessions,
    pr?.sourceBranch ?? branch
  );
  const dialog = launchDialog(
    menu,
    state,
    branch,
    repo.cwd,
    launch,
    onChoose,
    closeMenu
  );

  // A pull request is the full review workspace (its own merged header,
  // rail, and content). A bare worktree keeps a simple header + terminal.
  if (pr) {
    return (
      <div ref={paneRef} className="flex h-full min-h-0 min-w-0 flex-col">
        <PrWorkspace
          pr={pr}
          branch={pr.sourceBranch}
          baseBranch={pr.targetBranch}
          ownSession={sessionName}
          running={running}
          busy={busy}
          onLaunch={onLaunchClick}
          sessions={sessions}
        />
        {dialog}
        {terminalDialog}
      </div>
    );
  }

  // A worktree without a PR: same workspace, gracefully degraded —
  // sessions and files with the diff vs the default branch; no
  // comments/drafts sections. Worktree still being created → loader.
  return (
    <div ref={paneRef} className="flex h-full min-h-0 min-w-0 flex-col">
      {hasWorktree ? (
        <PrWorkspace
          branch={branch}
          baseBranch={baseBranch}
          ownSession={sessionName}
          running={running}
          busy={busy}
          onLaunch={onLaunchClick}
          sessions={sessions}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <TerminalIcon className="size-10 opacity-30" />
          <p className="text-base">No worktree for this branch yet.</p>
          <Button onClick={onLaunchClick} disabled={busy}>
            <PlayIcon /> Check out & launch
          </Button>
        </div>
      )}
      {dialog}
      {terminalDialog}
    </div>
  );
}
