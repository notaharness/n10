import type { PullRequestReviewer, ReviewDecision } from '@n10/vcs-core/types';
import type { ReviewVerdict } from '../../../host/contract.js';

/**
 * What the viewer's reviewer entry becomes for a cast verdict.
 *
 * The verdicts n10 offers are finer-grained than the decisions a
 * provider records, so this is a fold, not a rename. GitHub folds the
 * whole negative side into a changes-requested review; a provider that
 * distinguishes them (Azure DevOps) keeps "waiting for author" apart
 * from an outright rejection.
 */
export function verdictDecision(
  verdict: ReviewVerdict,
  providerId: string | undefined
): ReviewDecision {
  if (verdict === 'approve' || verdict === 'approve-with-suggestions')
    return 'approved';
  if (providerId === 'github') return 'changes-requested';
  return verdict === 'wait-for-author' ? 'waiting-for-author' : 'rejected';
}

/**
 * The reviewer list once the viewer's verdict lands, for the optimistic
 * patch: their own row takes the decision, or a `You` row is added.
 *
 * Azure DevOps rolls a member's vote into every group of theirs on the
 * pull request and names those groups in `votedFor`, so the patched row
 * names them too and a tally counts one vote, as the re-read will. The
 * groups a row already names stay: `includesViewer` marks only project
 * teams, and an earlier vote may also have answered for another group.
 * GitHub marks no group as the viewer's, so it adds nothing there.
 */
export function withViewerVerdict(
  reviewers: readonly PullRequestReviewer[],
  viewerIdentifier: string,
  decision: ReviewDecision
): PullRequestReviewer[] {
  const me = viewerIdentifier.toLowerCase();
  const isMe = (r: PullRequestReviewer) => r.identifier.toLowerCase() === me;
  const groups = reviewers
    .filter((r) => r.includesViewer)
    .map((r) => r.identifier);
  const voted = (already: readonly string[] = []) => {
    const all = [...new Set([...already, ...groups])];
    return all.length > 0 ? { votedFor: all } : {};
  };
  if (reviewers.some(isMe)) {
    return reviewers.map((r) =>
      isMe(r) ? { ...r, decision, ...voted(r.votedFor) } : r
    );
  }
  return [
    ...reviewers,
    { identifier: viewerIdentifier, displayName: 'You', decision, ...voted() },
  ];
}
