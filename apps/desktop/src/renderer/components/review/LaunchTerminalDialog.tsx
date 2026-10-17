import { useState } from 'react';
import type { LaunchStep } from '../../../host/contract.js';
import { useMachines } from '../../lib/data/queries.js';
import { preferredMachineChoice } from '../../lib/machines/machine-model.js';
import { MachineSelect } from '../machines/MachineSelect.js';
import { RemoteLaunchProgress } from '../terminal/NewTerminalMachineChoice.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';

/**
 * Launch Terminal's machine choice, shown only with another machine in
 * the fleet (D8). It starts on `defaultMachine`, the machine of the
 * branch's running agent, and keeps it while that machine is briefly
 * unavailable rather than switching to this one. It stays open
 * through a remote launch to show its step and any failure.
 */
export function LaunchTerminalDialog({
  branch,
  defaultMachine,
  busy,
  remoteStep,
  remoteError,
  onLaunch,
  onClose,
}: {
  branch: string;
  /** `'local'` or a peerId. */
  defaultMachine: string;
  busy: boolean;
  remoteStep: LaunchStep | null;
  remoteError: string | null;
  onLaunch: (machine: string | undefined) => void;
  onClose: () => void;
}) {
  const machines = useMachines().data ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const choice = preferredMachineChoice(machines, chosen, defaultMachine);
  const label = machines.find((m) => m.peerId === choice.value)?.label ?? '';
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Launch terminal</DialogTitle>
          <DialogDescription>
            A shell in the checkout of {branch} on the machine you pick.
          </DialogDescription>
        </DialogHeader>
        <MachineSelect
          id="launch-terminal-machine"
          machines={machines}
          value={choice.value}
          onChange={setChosen}
        />
        {choice.unavailable && (
          <p className="text-sm text-muted-foreground">
            {choice.unavailable.label} is not connected. Wait for it, or pick
            another machine.
          </p>
        )}
        <RemoteLaunchProgress
          step={remoteStep}
          error={remoteError}
          machineLabel={label}
          what="shell"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onLaunch(choice.remote)}
            disabled={busy || choice.unavailable !== null}
          >
            Open terminal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
