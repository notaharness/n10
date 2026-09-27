import { UsersIcon, XCircleIcon } from 'lucide-react';
import type { PullRequestReviewer } from '@n10/vcs-core/types';
import {
  DECISION_LABEL,
  HOLDING_VERDICTS,
} from '../../lib/review/overview-model.js';
import { cn } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Tip } from '../ui/tooltip.js';

/** Avatars the header has room for; the rest are counted. */
const MAX_AVATARS = 6;

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

/** Reviewer avatars, each dotted with where that reviewer landed, for a
 *  header with room to spare. The dot is never the only signal:
 *  {@link ReviewerSummary} says it in words beside them. */
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
      {reviewers.slice(0, MAX_AVATARS).map((r) => (
        <Tip
          key={r.identifier}
          label={`${r.displayName}: ${DECISION_LABEL[r.decision]}`}
        >
          <span className="relative">
            <span className="sr-only">
              {r.displayName}: {DECISION_LABEL[r.decision]}
            </span>
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
      {reviewers.length > MAX_AVATARS && (
        <span className="text-xs text-muted-foreground">
          +{reviewers.length - MAX_AVATARS}
          <span className="sr-only"> more reviewers</span>
        </span>
      )}
    </span>
  );
}

/** Where the reviews stand, in words. The Overview lists each
 *  reviewer. */
export function ReviewerSummary({
  reviewers,
  className,
}: {
  reviewers: readonly PullRequestReviewer[];
  className?: string;
}) {
  if (reviewers.length === 0) return null;
  // The most severe verdict holding it back, in the provider's words.
  const holding = HOLDING_VERDICTS.find((d) =>
    reviewers.some((r) => r.decision === d)
  );
  const approved = reviewers.filter((r) => r.decision === 'approved').length;
  return (
    <span
      data-reviewer-summary
      className={cn(
        'items-center gap-1',
        holding === 'rejected'
          ? 'text-destructive'
          : holding
          ? 'text-warning'
          : 'text-muted-foreground',
        className
      )}
    >
      {holding ? (
        <XCircleIcon aria-hidden className="size-3.5" />
      ) : (
        <UsersIcon aria-hidden className="size-3.5" />
      )}
      {holding
        ? DECISION_LABEL[holding]
        : `${approved}/${reviewers.length} approved`}
    </span>
  );
}
