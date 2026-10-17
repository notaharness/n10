import { useState } from 'react';
import type { WorktreeRemovalCheck } from '@n10/core';

export type DeleteConfirmMode = 'type-branch' | 'yes-no';

export interface DeleteConfirmState {
  branch: string;
  reason: string;
  // 'type-branch' = high friction (typing the branch name) for branches
  // with uncommitted/unpushed work that would be lost on disk.
  // 'yes-no' = low friction (Y/N) when only the in-memory agent session
  // is at stake — the branch itself is git-clean.
  mode: DeleteConfirmMode;
  /** The verdict the prompt shows. Confirming removes with exactly
   *  this, so nothing the check did not see is forced away. */
  approved: WorktreeRemovalCheck;
}

export function useDeleteConfirmation() {
  const [confirmDelete, setConfirmDelete] = useState<DeleteConfirmState | null>(
    null
  );
  const [confirmInput, setConfirmInput] = useState('');

  return {
    confirmDelete,
    setConfirmDelete,
    confirmInput,
    setConfirmInput,
  };
}
