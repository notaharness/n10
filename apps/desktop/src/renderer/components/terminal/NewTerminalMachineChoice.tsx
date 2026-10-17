import { AlertTriangleIcon, Loader2Icon } from 'lucide-react';
import type { LaunchStep } from '../../../host/contract.js';
import { launchStepLabel } from '../../lib/machines/machine-model.js';
import type { useMachineChoice } from '../../lib/machines/use-machine-choice.js';
import { MachineSelect } from '../machines/MachineSelect.js';

/** The machine `Select`, rendered only when `useMachineChoice().show`. */
export function MachineChoiceSelect({
  id,
  choice,
  onSubmit,
}: {
  id: string;
  choice: ReturnType<typeof useMachineChoice>;
  /** See `MachineSelect`. */
  onSubmit?: () => void;
}) {
  if (!choice.show) return null;
  return (
    <MachineSelect
      id={id}
      machines={choice.machines}
      value={choice.value}
      onChange={choice.setValue}
      onSubmit={onSubmit}
    />
  );
}

/** The step display and the failure it can end in (ux-machines.md §5).
 *  Nothing renders for a local launch — the caller only ever has a
 *  step to show when the request named a machine. */
export function RemoteLaunchProgress({
  step,
  error,
  machineLabel,
  what,
}: {
  step?: LaunchStep | null;
  error?: string | null;
  machineLabel: string;
  what: string;
}) {
  if (error) {
    return (
      <p role="alert" className="flex items-center gap-2 text-sm text-warning">
        <AlertTriangleIcon className="size-3.5 shrink-0" />
        {error}
      </p>
    );
  }
  if (!step) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
      {launchStepLabel(step, machineLabel, what)}
    </p>
  );
}
