import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MachineView } from '../../../host/contract.js';
import { keys } from '../data/query-keys.js';
import { isFleetMember } from '../machines/machine-model.js';

/** Track identities at opening, so reconnects and renames cannot finish adding. */
export function useAddMachine() {
  const qc = useQueryClient();
  const [adding, setOpen] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const setAdding = useCallback(
    (open: boolean) => {
      if (open && known.current) return;
      const machines = qc.getQueryData<MachineView[]>(keys.machines) ?? [];
      known.current = open ? new Set(machines.map((m) => m.peerId)) : null;
      setOpen(open);
    },
    [qc]
  );
  const machinesChanged = useCallback((machines: MachineView[]) => {
    const joined = machines.find(
      (m) => known.current && isFleetMember(m) && !known.current.has(m.peerId)
    );
    if (!joined) return;
    known.current = null;
    setOpen(false);
    toast.success(`${joined.label} joined`);
  }, []);
  return { adding, setAdding, machinesChanged };
}
