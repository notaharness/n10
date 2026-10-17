import type { MachineView } from '../../../host/contract.js';
import { machineSelectOptions } from '../../lib/machines/machine-model.js';
import { Label } from '../ui/label.js';
import { selectKey } from '../ui/select-keys.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';

/**
 * The machine a launch runs on (ux-machines.md §5). Callers render this
 * only when a peer machine is registered (D8) — with only the local
 * machine, there is nothing to choose, and this component does not
 * decide that on its own.
 *
 * A machine that cannot be launched on right now is listed disabled
 * with its reason beside it, never omitted: a user who cannot find a
 * fleet member here would otherwise conclude it never joined.
 */
export function MachineSelect({
  id,
  machines,
  value,
  onChange,
  onSubmit,
}: {
  id: string;
  machines: MachineView[];
  /** The selected machine's peerId. */
  value: string;
  onChange: (peerId: string) => void;
  /** Given, Enter on the closed picker launches and the arrows step
   *  through the machines that can be chosen, as the session menu's
   *  agent picker does (`selectKey`). */
  onSubmit?: () => void;
}) {
  const options = machineSelectOptions(machines);
  const choosable = options
    .filter((o) => !o.disabled)
    .map((o) => o.machine.peerId);
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>Machine</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          aria-label="Machine"
          className="w-full min-w-0"
          onKeyDown={
            onSubmit &&
            ((e) => selectKey(e, choosable, value, onChange, onSubmit))
          }
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(({ machine, disabled, reason }) => (
            <SelectItem
              key={machine.peerId}
              value={machine.peerId}
              disabled={disabled}
            >
              <span className="truncate">{machine.label}</span>
              {reason && (
                <span className="truncate text-muted-foreground">
                  {' '}
                  — {reason}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
