import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BranchTerminalRequest } from '../../../host/contract.js';
import { keys } from './query-keys.js';

/**
 * A branch's agents and the terminals in its checkouts, on every
 * machine — the review sidebar's session list — and the machine a new
 * terminal opens on by default. The engine decides membership.
 */
export function useBranchSessions(cwd: string, branch: string) {
  return useQuery({
    queryKey: keys.branchSessions(cwd, branch),
    queryFn: () => window.n10.listBranchSessions(cwd, branch),
    refetchInterval: 2_000,
    placeholderData: (prev) => prev,
    enabled: branch !== '',
  });
}

/** Open a shell in the branch's checkout on a machine. */
export function useLaunchBranchTerminal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: BranchTerminalRequest) =>
      window.n10.launchBranchTerminal(req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.terminals });
      void qc.invalidateQueries({ queryKey: keys.branchSessionsAll });
    },
  });
}
