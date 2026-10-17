import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  useBranchSessions,
  useLaunchBranchTerminal,
} from '../data/branch-sessions.js';
import { useKillSession } from '../data/mutations.js';
import { useKillTerminal } from '../data/mutations-terminals.js';
import { useMachines } from '../data/queries.js';
import { useLaunchProgress } from '../machines/launch-progress.js';
import { hasPeerMachines } from '../machines/machine-model.js';
import type { Grid } from '../terminal-grid.js';
import { errorMessage } from '../utils.js';
import { sessionCards, type SessionCard } from './session-cards.js';

/**
 * The review rail's sessions: the branch's cards, stopping one, and
 * Launch Terminal — straight onto this machine without another one in
 * the fleet (D8), else through the machine choice, which a remote
 * launch keeps open until it lands or fails.
 */
export function useBranchSessionRail(
  cwd: string,
  branch: string,
  estimateGrid: () => Partial<Grid>
) {
  const query = useBranchSessions(cwd, branch);
  const machines = useMachines();
  const cards = useMemo(
    () => sessionCards(query.data?.sessions ?? [], machines.data),
    [query.data, machines.data]
  );
  const killSession = useKillSession(cwd);
  const killTerminal = useKillTerminal();
  const launch = useLaunchBranchTerminal();
  const progress = useLaunchProgress();
  const [choosing, setChoosing] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const stop = (card: SessionCard) =>
    (card.kind === 'agent' ? killSession : killTerminal).mutate(card.name, {
      onError: (e) => toast.error(errorMessage(e)),
    });

  const closeChoice = () => {
    progress.reset();
    setRemoteError(null);
    setChoosing(false);
  };

  const launchOn = (machine: string | undefined) => {
    const launchId = machine ? progress.start() : undefined;
    setRemoteError(null);
    launch.mutate(
      { branch, ...estimateGrid(), ...(machine ? { machine, launchId } : {}) },
      {
        onSuccess: closeChoice,
        onError: (e) =>
          machine
            ? setRemoteError(errorMessage(e))
            : toast.error(errorMessage(e)),
      }
    );
  };

  const launchTerminal = () =>
    hasPeerMachines(machines.data ?? [])
      ? setChoosing(true)
      : launchOn(undefined);

  return {
    cards,
    /** The first answer is in: sessions listed after it are new. */
    loaded: query.data !== undefined,
    terminalMachine: query.data?.terminalMachine ?? 'local',
    stop,
    launchTerminal,
    terminalBusy: launch.isPending,
    choice: choosing
      ? {
          launchOn,
          close: closeChoice,
          remoteStep: progress.step,
          remoteError,
        }
      : null,
  };
}

export type BranchSessionRail = ReturnType<typeof useBranchSessionRail>;
