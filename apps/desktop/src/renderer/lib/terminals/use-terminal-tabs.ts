import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type {
  MachineView,
  TerminalKind,
  TerminalSummary,
} from '../../../host/contract.js';
import { useMachines, useTerminalListing } from '../data/queries.js';
import { useLaunchTerminal } from '../data/mutations-terminals.js';
import { useLaunchProgress } from '../machines/launch-progress.js';
import { useTabs, type TerminalEntry } from '../tabs/tabs.js';
import { estimateTerminalGrid, paneTerminalGrid } from '../terminal-grid.js';
import { terminalLaunchRequest } from './terminal-launch-request.js';
import { errorMessage } from '../utils.js';

/** The host's summary, as the tab model keeps it, with its machine's
 *  name when the fleet knows it. */
function toEntry(
  t: TerminalSummary,
  machines?: readonly MachineView[]
): TerminalEntry {
  const label = machines?.find(
    (m) => !m.isLocal && m.peerId === t.machine
  )?.label;
  return {
    name: t.name,
    kind: t.kind,
    cwd: t.cwd,
    displayPath: t.displayPath,
    repo: t.repo,
    ...(t.branch ? { branch: t.branch } : {}),
    ...(t.created !== undefined ? { created: t.created } : {}),
    machine: t.machine,
    ...(label ? { machineLabel: label } : {}),
  };
}

/**
 * The grid a new terminal is spawned at. Measured off the pane area the
 * tab will occupy when there is one on screen; a window with no tabs
 * open has no pane to measure, so the editor's share of the window is
 * the estimate then. The terminal corrects it the moment it mounts.
 */
function estimatePane(): { cols?: number; rows?: number } {
  const panes = document.querySelector<HTMLElement>('[data-editor-panes]');
  const measured = panes ? paneTerminalGrid(panes) : null;
  if (measured) return measured;
  return estimateTerminalGrid({
    width: window.innerWidth - 280,
    height: window.innerHeight - 80,
  });
}

/**
 * Terminal tabs, renderer side: the host's terminal listing, ready for
 * Workspace's own `sync-items` effect to reconcile alongside the
 * sidebar (the restore path, and terminals discovery finds mid-run),
 * plus opening one on request.
 *
 * Deliberately does not dispatch a sync of its own — terminals are not
 * sidebar items and the listing is not repo-scoped, but folding both
 * into the one action Workspace dispatches keeps every reconciliation
 * of the strip behind a single pure step instead of two effects racing
 * into the reducer independently.
 */
export function useTerminalTabs() {
  const tabs = useTabs();
  const listing = useTerminalListing();
  const machines = useMachines().data;
  const launch = useLaunchTerminal();
  const progress = useLaunchProgress();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  // `undefined` until the host's listing is complete for this machine —
  // discovery's first scan has adopted what tmux kept — and it stays the
  // previous answer across a refetch (`placeholderData`), so the strip
  // never sees "no terminals" when the truth is "not found yet". The
  // reducer closes the tab of any terminal a listing does not name.
  const data = listing.data;
  const complete = data?.scanned.includes('local') ?? false;
  const entries = useMemo(
    () =>
      complete ? data?.terminals.map((t) => toEntry(t, machines)) : undefined,
    [complete, data, machines]
  );
  const scanned = data?.scanned;

  const launchMutate = launch.mutate;
  const openTerminal = tabs.openTerminal;
  const launchTerminal = useCallback(
    (kind: TerminalKind, cwd: string, machine?: string) => {
      setRemoteError(null);
      // Local launch: unchanged from before this phase — the dialog
      // closes right away and the request carries exactly what it
      // carries today (no `machine`, no `launchId`).
      if (!machine) {
        setDialogOpen(false);
        launchMutate(terminalLaunchRequest(kind, cwd, estimatePane()), {
          onSuccess: (summary) => openTerminal(toEntry(summary)),
          onError: (e) => toast.error(errorMessage(e)),
        });
        return;
      }
      // Remote launch: the dialog stays open and shows the step
      // (ux-machines.md §5) until the launch actually succeeds. A
      // failure leaves the dialog open with the input intact, naming
      // the step it failed on — closing eagerly here would lose a
      // typed choice to a network error.
      const launchId = progress.start();
      launchMutate(
        terminalLaunchRequest(kind, cwd, estimatePane(), machine, launchId),
        {
          onSuccess: (summary) => {
            progress.reset();
            setDialogOpen(false);
            openTerminal(toEntry(summary));
          },
          onError: (e) => setRemoteError(errorMessage(e)),
        }
      );
    },
    [launchMutate, openTerminal, progress]
  );

  return {
    /** The host's terminal listing, for Workspace's sync effect;
     *  `undefined` before it is complete for this machine. */
    entries,
    /** The machines the listing is complete for. */
    scanned,
    dialogOpen,
    openDialog: useCallback(() => setDialogOpen(true), []),
    closeDialog: useCallback(() => {
      setDialogOpen(false);
      progress.reset();
      setRemoteError(null);
    }, [progress]),
    launchTerminal,
    busy: launch.isPending,
    /** Set only during a remote launch (ux-machines.md §5); a local
     *  launch is fast enough that showing this would be a regression. */
    remoteStep: progress.step,
    remoteError,
  };
}
