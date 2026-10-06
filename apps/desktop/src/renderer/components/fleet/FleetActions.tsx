import { MoreHorizontalIcon } from 'lucide-react';
import { useId, useRef } from 'react';
import { COPY_LABEL, RESET_LABEL } from '../../lib/fleet/use-fleet-actions.js';
import { Button } from '../ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';

/** The header's "…" menu: the fleet fingerprint and the context menu's
 *  actions, reachable by pointer and keyboard. */
export function FleetActionsMenu({
  fingerprint,
  resetDisabled,
  onCopy,
  onReset,
}: {
  fingerprint: string;
  resetDisabled: boolean;
  onCopy: () => void;
  onReset: () => void;
}) {
  // Reset opens once the menu has closed, instead of focus returning to
  // the trigger, so the confirmation's heading takes focus.
  const resetChosen = useRef(false);
  const labelId = useId();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="Fleet actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-labelledby={labelId}
        onCloseAutoFocus={(e) => {
          if (!resetChosen.current) return;
          resetChosen.current = false;
          e.preventDefault();
          onReset();
        }}
      >
        <DropdownMenuLabel id={labelId}>
          Fleet{' '}
          <span
            className="font-mono font-normal normal-case tracking-normal text-popover-foreground"
            data-testid="fleet-menu-fingerprint"
          >
            {fingerprint}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={onCopy}>{COPY_LABEL}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={resetDisabled}
          onSelect={() => {
            resetChosen.current = true;
          }}
        >
          {RESET_LABEL}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
