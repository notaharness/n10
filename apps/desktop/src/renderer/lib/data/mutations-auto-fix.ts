import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from './query-keys.js';

/**
 * The renderer's auto-fix writes — start and stop watching a pull
 * request. Split from `mutations.ts`, which is a catalogue already.
 */

// The  of a pull request under auto-fix rides on its sidebar item, so the
// row's badge appears — and goes — with the sidebar's refetch.
export function useStartAutoFix(cwd: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: number) => window.n10.startAutoFix(prId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sidebar(cwd) });
    },
  });
}

export function useStopAutoFix(cwd: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: number) => window.n10.stopAutoFix(prId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sidebar(cwd) });
    },
  });
}
