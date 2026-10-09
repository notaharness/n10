import type { MouseEvent } from 'react';
import { toast } from 'sonner';
import { copyText } from '../copy-text.js';
import { useBeamStatus, useMachines } from '../data/queries.js';
import { fingerprintGroups } from '../machines/machine-model.js';
import { errorMessage } from '../utils.js';
import { useFleet } from './fleet-context.js';

export const COPY_LABEL = 'Copy fleet fingerprint';
export const RESET_LABEL = 'Reset fleet…';

/** Moves focus off the header, so the confirmation's heading takes it
 *  (`useFocusOnMount` leaves focus that is somewhere else alone). */
function releaseFocus(header: HTMLElement): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && header.contains(active)) active.blur();
}

/**
 * The enrolled fleet's header actions (beam-fleet-ux.md §1): Add a
 * machine, its fingerprint, for the post-join check on another
 * machine, and Reset fleet…, which opens its typed confirmation in the
 * section. `fingerprint` is null until this machine is in a fleet. Add
 * and reset are disabled while the section cannot show their panels,
 * while the other flow or a passkey flow runs, or while the reset
 * confirmation is already open.
 */
export function useFleetActions() {
  const { section, setAdding, reset, enrolment, revocation } = useFleet();
  const status = useBeamStatus();
  const beam = status.data;
  const machines = useMachines().data;
  const fingerprint =
    beam?.enrolled && beam.fleetId ? fingerprintGroups(beam.fleetId) : null;
  // What FleetPanel needs before it renders FleetBody, which holds both
  // the add instructions and the reset confirmation.
  const bodyShown = !status.isError && !!machines && beam?.state === 'ready';
  const busy = !bodyShown || reset.open || revocation.ceremony.running;
  const addDisabled = busy || enrolment.ceremony.view !== null;
  const resetDisabled = busy || enrolment.ceremony.running;
  const copyFingerprint = () => {
    if (fingerprint) copyText(fingerprint, 'Fleet fingerprint copied');
  };
  const showAdd = () => {
    setAdding(true);
    section.setExpanded(true);
  };
  const showReset = () => {
    reset.show();
    section.setExpanded(true);
  };
  /** The header's native context menu: the "…" menu's actions. */
  const openContextMenu = (e: MouseEvent<HTMLElement>) => {
    if (!fingerprint) return;
    e.preventDefault();
    const header = e.currentTarget;
    window.n10
      .showContextMenu([
        { id: 'copy', label: COPY_LABEL },
        { type: 'separator' },
        {
          id: 'reset',
          label: RESET_LABEL,
          enabled: !resetDisabled,
          danger: true,
        },
      ])
      .then(
        (chosen) => {
          if (chosen === 'copy') copyFingerprint();
          if (chosen !== 'reset') return;
          releaseFocus(header);
          showReset();
        },
        (err: unknown) => toast.error(errorMessage(err))
      );
  };
  return {
    fingerprint,
    addDisabled,
    resetDisabled,
    copyFingerprint,
    showAdd,
    showReset,
    openContextMenu,
  };
}
