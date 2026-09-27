import { toast } from 'sonner';
import { useAddMachine } from './use-add-machine.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MachineView } from '../../../host/contract.js';
import { keys } from '../data/query-keys.js';
import { useCeremony, type Ceremony } from './use-ceremony.js';
import { useEnrolment, type Enrolment } from './use-enrolment.js';
import { useFleetReset } from './use-fleet-reset.js';
import { usePublication, type Publication } from './publication.js';

const EXPANDED_KEY = 'n10.fleet.expanded';

/** Expanded unless this machine's user collapsed it. */
function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) !== '0';
  } catch {
    return true;
  }
}

function storeExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0');
  } catch {
    // A convenience only: the section opens expanded next time.
  }
}

/** The sidebar's Fleet section: whether it is open, and a request to
 *  bring it into view from elsewhere (the status bar, Settings). */
export interface FleetSectionState {
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  /** Open the section, show the sidebar holding it and focus it. */
  reveal: () => void;
  /** Bumped by `reveal`; the section focuses itself when it changes. */
  revealSeq: number;
  /** Whether a reveal is still waiting for the section to take focus;
   *  true once per reveal, so a remounted section does not steal it. */
  takeRevealFocus: () => boolean;
  /** Registers what shows the sidebar (the workspace's), for `reveal`. */
  setRevealHost: (show: (() => void) | null) => void;
}

interface FleetContextValue {
  section: FleetSectionState;
  /** Add-a-machine instructions showing in the section. */
  adding: boolean;
  setAdding: (adding: boolean) => void;
  /** The first run: its choice, form values and ceremony. Owned here,
   *  above the repository gate, so collapsing the sidebar or switching
   *  repositories keeps them. */
  enrolment: Enrolment;
  /** The revocation dialog's machine and ceremony, kept the same way. */
  revocation: {
    target: MachineView | null;
    ceremony: Ceremony;
    open: (machine: MachineView) => void;
    close: () => void;
  };
  reset: ReturnType<typeof useFleetReset>;
  publication: Publication;
}

const FleetContext = createContext<FleetContextValue | null>(null);

/** The machines list and beam's status are pushed whole on every
 *  change; they go straight into the cache, whatever screen is up. */
function useFleetPushes(onMachines: (machines: MachineView[]) => void): void {
  const qc = useQueryClient();
  useEffect(() => {
    const offMachines = window.n10.onMachinesChanged((machines) => {
      qc.setQueryData(keys.machines, machines);
      onMachines(machines);
    });
    const offStatus = window.n10.onBeamStatusChanged((status) => {
      qc.setQueryData(keys.beamStatus, status);
    });
    return () => {
      offMachines();
      offStatus();
    };
  }, [qc, onMachines]);
}

function useFleetSection(): FleetSectionState {
  const [expanded, setExpandedState] = useState(readExpanded);
  const [revealSeq, setRevealSeq] = useState(0);
  const focusPending = useRef(false);
  const revealHost = useRef<(() => void) | null>(null);
  const setExpanded = useCallback((next: boolean) => {
    setExpandedState(next);
    storeExpanded(next);
  }, []);
  const reveal = useCallback(() => {
    revealHost.current?.();
    setExpanded(true);
    focusPending.current = true;
    setRevealSeq((n) => n + 1);
  }, [setExpanded]);
  const takeRevealFocus = useCallback(() => {
    const pending = focusPending.current;
    focusPending.current = false;
    return pending;
  }, []);
  const setRevealHost = useCallback((show: (() => void) | null) => {
    revealHost.current = show;
  }, []);
  return useMemo(
    () => ({
      expanded,
      setExpanded,
      reveal,
      revealSeq,
      takeRevealFocus,
      setRevealHost,
    }),
    [expanded, setExpanded, reveal, revealSeq, takeRevealFocus, setRevealHost]
  );
}

/**
 * Fleet lives in the sidebar, not on a page of its own
 * (beam-fleet-ux.md §1). This sits above the repository gate and owns
 * the section's state, the fleet data subscriptions and the one
 * enrolment controller, so none of them depend on which sidebar shows.
 */
export function FleetProvider({ children }: { children: ReactNode }) {
  const section = useFleetSection();
  const { adding, setAdding, machinesChanged } = useAddMachine();
  const publication = usePublication();
  const { settle, clear } = publication;
  const hooks = useMemo(() => ({ onSettled: settle }), [settle]);
  const enrolment = useEnrolment(hooks);
  const [revokeTarget, setRevokeTarget] = useState<MachineView | null>(null);
  const revokeHooks = useMemo(
    () => ({
      onSettled: (outcome: Parameters<typeof settle>[0]) => {
        settle(outcome);
        if (outcome.ok) {
          setRevokeTarget(null);
          toast.success('Access revoked', {
            description: 'Offline machines update when they reconnect.',
          });
        }
      },
    }),
    [settle]
  );
  const revokeCeremony = useCeremony(revokeHooks);
  const { leave } = enrolment;
  const afterReset = useCallback(() => {
    leave();
    clear();
    setAdding(false);
  }, [leave, clear, setAdding]);
  const reset = useFleetReset(afterReset);
  useFleetPushes(machinesChanged);

  const resetRevocation = revokeCeremony.reset;
  const openRevocation = useCallback(
    (machine: MachineView) => {
      resetRevocation();
      setRevokeTarget(machine);
    },
    [resetRevocation]
  );
  const closeRevocation = useCallback(() => setRevokeTarget(null), []);
  const value = useMemo(
    () => ({
      section,
      adding,
      setAdding,
      enrolment,
      revocation: {
        target: revokeTarget,
        ceremony: revokeCeremony,
        open: openRevocation,
        close: closeRevocation,
      },
      reset,
      publication,
    }),
    [
      section,
      adding,
      setAdding,
      enrolment,
      revokeTarget,
      revokeCeremony,
      closeRevocation,
      openRevocation,
      reset,
      publication,
    ]
  );
  return (
    <FleetContext.Provider value={value}>{children}</FleetContext.Provider>
  );
}

export function useFleet(): FleetContextValue {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleet must be used inside FleetProvider');
  return ctx;
}
