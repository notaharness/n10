import { MoreHorizontalIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { toast } from 'sonner';
import { useBeamStatus } from '../../lib/data/queries.js';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';

const RESET_LABEL = 'Reset fleet…';

/**
 * The enrolled fleet's rare actions (beam-fleet-ux.md §1): today only
 * Reset fleet…, which opens its typed confirmation in the section.
 * `available` is false until this machine is in a fleet; `disabled`
 * while reconnecting, while a passkey flow runs or while the
 * confirmation is already open.
 */
export function useFleetActions() {
  const { section, reset, enrolment, revocation } = useFleet();
  const beam = useBeamStatus().data;
  const available = !!beam?.enrolled && !!beam.fleetId;
  const disabled =
    beam?.state !== 'ready' ||
    reset.open ||
    enrolment.ceremony.running ||
    revocation.ceremony.running;
  const showReset = () => {
    reset.show();
    section.setExpanded(true);
  };
  /** The header's native context menu, the same entry as the "…" menu. */
  const openContextMenu = (e: MouseEvent) => {
    if (!available) return;
    e.preventDefault();
    window.n10
      .showContextMenu([
        { id: 'reset', label: RESET_LABEL, enabled: !disabled, danger: true },
      ])
      .then(
        (chosen) => {
          if (chosen === 'reset') showReset();
        },
        (err: unknown) => toast.error(errorMessage(err))
      );
  };
  return { available, disabled, showReset, openContextMenu };
}

/** The header's "…" menu: the context menu's entries, reachable by
 *  pointer and keyboard. */
export function FleetActionsMenu({
  disabled,
  onReset,
}: {
  disabled: boolean;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="Fleet actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          variant="destructive"
          disabled={disabled}
          onSelect={onReset}
        >
          {RESET_LABEL}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
