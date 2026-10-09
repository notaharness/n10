import { useState } from 'react';
import { useMachines } from '../data/queries.js';
import { hasPeerMachines, machineChoice } from './machine-model.js';

/**
 * The dialog's machine choice (ux-machines.md §5). Split out of
 * `NewTerminalDialog` to keep both files' complexity and length down:
 * this owns "which machine", the dialog owns "where"/"what".
 *
 * `show` is D8's gate — with only the local machine registered there
 * is nothing to choose, and the caller renders no control at all.
 * `selectedMachine()` is what actually goes on the launch request: the
 * local default resolves to `undefined`, never `'local'` or the local
 * machine's own peerId, so a local launch's request is unchanged from
 * before this phase. `machineChoice` re-reads the pick against the
 * live list on every render, so a machine that stops being selectable
 * while the dialog is open is dropped from both the control and the
 * request rather than submitted and failed remotely.
 */
export function useMachineChoice() {
  const machines = useMachines();
  const list = machines.data ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const { value, remote } = machineChoice(list, chosen);
  return {
    show: hasPeerMachines(list),
    machines: list,
    value,
    setValue: setChosen,
    selectedMachine: (): string | undefined => remote,
    selectedLabel: (): string =>
      list.find((m) => m.peerId === value)?.label ?? '',
  };
}
