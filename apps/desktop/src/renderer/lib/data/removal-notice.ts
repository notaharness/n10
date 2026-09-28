import type { WorktreeRemovalOutcome } from '../../../host/contract.js';

/** What to tell the user when a removal kept something, and why. */
export function keptNotice(
  branch: string,
  outcome: WorktreeRemovalOutcome
): string | null {
  switch (outcome) {
    case 'removed':
      return null;
    case 'kept-branch':
      return `Removed the worktree; kept ${branch}: it has commits made after the check`;
    case 'changed':
      return `Kept ${branch}: it changed after the check`;
    case 'git-refused':
      return `Kept ${branch}: git would not remove its worktree`;
    case 'refused':
      return `Kept ${branch}: it cannot be removed`;
  }
}
