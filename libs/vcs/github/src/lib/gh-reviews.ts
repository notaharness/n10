import type { ReviewDecision } from '@n10/vcs-core';

/** A GitHub review state in the shared vocabulary. A comment is not a
 *  verdict, and neither is a review still being written. */
export function mapReviewState(state: string): ReviewDecision {
  switch (state) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changes-requested';
    case 'DISMISSED':
      return 'declined';
    case 'COMMENTED':
    case 'PENDING':
    default:
      return 'no-response';
  }
}
