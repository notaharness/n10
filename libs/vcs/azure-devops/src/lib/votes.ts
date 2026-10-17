import type { ReviewDecision } from '@n10/vcs-core';

/** An Azure DevOps vote in the shared vocabulary. Approve (10) and
 *  approve with suggestions (5) both read as approved; the vote itself
 *  is kept wherever a reader needs them apart. */
export function voteToDecision(
  vote: number,
  hasDeclined: boolean
): ReviewDecision {
  if (hasDeclined) return 'declined';
  if (vote === 10 || vote === 5) return 'approved';
  if (vote === -5) return 'waiting-for-author';
  if (vote === -10) return 'rejected';
  return 'no-response';
}
