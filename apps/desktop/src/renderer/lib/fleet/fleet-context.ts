import { createContext, useContext } from 'react';
import type { MachineView } from '../../../host/contract.js';
import type { Ceremony } from './use-ceremony.js';
import type { Enrolment } from './use-enrolment.js';
import type { useFleetReset } from './use-fleet-reset.js';
import type { Publication } from './publication.js';

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

export interface FleetContextValue {
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

export const FleetContext = createContext<FleetContextValue | null>(null);

export function useFleet(): FleetContextValue {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleet must be used inside FleetProvider');
  return ctx;
}
