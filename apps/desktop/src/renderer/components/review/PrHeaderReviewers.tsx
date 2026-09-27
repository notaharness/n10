import { UsersIcon, XCircleIcon } from 'lucide-react';
import {
  isBlockingDecision,
  type PullRequestReviewer,
} from '@n10/vcs-core/types';
import { DECISION_LABEL } from '../../lib/review/overview-model.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Tip } from '../ui/tooltip.js';

/** Colour of the dot on a reviewer's avatar, by their verdict. */
function decisionDotClass(decision: string): string {
  if (decision === 'approved') return 'bg-success';
  if (decision === 'rejected') return 'bg-destructive';
  if (decision === 'changes-requested' || decision === 'waiting-for-author') {
    return 'bg-warning';
  }
  if (decision === 'no-response') return 'bg-muted-foreground/50';
  if (decision === 'declined') return 'bg-muted-foreground';
  return '';
}

/** Reviewer avatars, each dotted with where that reviewer landed. For a
 *  header with room to spare; {@link ReviewerSummary} says it in words. */
export function ReviewerDots({
  reviewers,
  className,
}: {
  reviewers: readonly PullRequestReviewer[];
  className?: string;
}) {
  if (reviewers.length === 0) return null;
  return (
    <span className={cn('items-center gap-1.5', className)}>
      {reviewers.slice(0, 6).map((r) => (
        <Tip
          key={r.identifier}
          label={`${r.displayName}: ${DECISION_LABEL[r.decision]}`}
        >
          <span className="relative">
            <Avatar name={r.displayName} size="xs" />
            <span
              className={cn(
                'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-background',
                decisionDotClass(r.decision)
              )}
            />
          </span>
        </Tip>
      ))}
    </span>
  );
}

/** Where the reviews stand, in words, for a header too narrow for the
 *  avatars. The Overview lists each reviewer. */
export function ReviewerSummary({
  reviewers,
  className,
}: {
  reviewers: readonly PullRequestReviewer[];
  className?: string;
}) {
  if (reviewers.length === 0) return null;
  const blocking = reviewers.some((r) => isBlockingDecision(r.decision));
  const approved = reviewers.filter((r) => r.decision === 'approved').length;
  return (
    <span
      data-reviewer-summary
      className={cn(
        'items-center gap-1',
        blocking ? 'text-warning' : 'text-muted-foreground',
        className
      )}
    >
      {blocking ? (
        <XCircleIcon aria-hidden className="size-3.5" />
      ) : (
        <UsersIcon aria-hidden className="size-3.5" />
      )}
      {blocking
        ? 'Changes requested'
        : `${approved}/${reviewers.length} approved`}
    </span>
  );
}
