import {
  CheckCircle2Icon,
  CircleDashedIcon,
  ClockIcon,
  MinusCircleIcon,
  XCircleIcon,
} from 'lucide-react';
import type { PullRequestReviewer, ReviewDecision } from '@n10/vcs-core/types';
import type { ReviewRequirements } from '../../../../host/contract.js';
import { DECISION_LABEL } from '../../../lib/review/overview-model.js';
import { reviewerRows } from '../../../lib/review/reviewer-model.js';
import { cn } from '../../../lib/utils.js';
import { Avatar } from '../../ui/avatar.js';
import { Section } from './parts.js';

const DECISION_ICON: Record<
  ReviewDecision,
  { icon: typeof CheckCircle2Icon; className: string }
> = {
  approved: { icon: CheckCircle2Icon, className: 'text-success' },
  'changes-requested': { icon: XCircleIcon, className: 'text-warning' },
  'waiting-for-author': { icon: ClockIcon, className: 'text-warning' },
  rejected: { icon: XCircleIcon, className: 'text-destructive' },
  'no-response': { icon: CircleDashedIcon, className: 'text-muted-foreground' },
  declined: { icon: MinusCircleIcon, className: 'text-muted-foreground' },
};

function Decision({ decision }: { decision: ReviewDecision }) {
  const { icon: Icon, className } = DECISION_ICON[decision];
  return (
    <span
      className={cn(
        'mt-0.5 flex shrink-0 items-center gap-1 text-xs',
        className
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {DECISION_LABEL[decision]}
    </span>
  );
}

/**
 * Everyone asked to review, each with their verdict in words and, where
 * the provider says, whether their review is required and why. The list
 * row names them until the detail read, which also names teams, answers.
 */
export function PrReviewers({
  reviewers,
  requirements,
  provider,
  viewer,
}: {
  reviewers: readonly PullRequestReviewer[];
  requirements: ReviewRequirements | null;
  provider: string | null;
  viewer: string | null;
}) {
  const me = viewer?.toLowerCase();
  const { rows, notes } = reviewerRows(reviewers, requirements, provider);
  return (
    <Section title="Reviewers">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reviewers requested.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((r) => (
            <li
              key={r.identifier}
              data-reviewer={r.identifier}
              className="flex items-start gap-2"
            >
              <Avatar name={r.displayName} size="xs" className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate" title={r.displayName}>
                  {r.displayName}
                  {r.identifier.toLowerCase() === me && (
                    <span className="text-muted-foreground"> (you)</span>
                  )}
                </span>
                {r.standing && (
                  <span
                    data-reviewer-standing
                    className="block text-xs text-muted-foreground"
                  >
                    {r.standing}
                  </span>
                )}
              </span>
              <Decision decision={r.decision} />
            </li>
          ))}
        </ul>
      )}
      {notes.map((n) => (
        <p key={n} className="mt-2 text-xs text-muted-foreground">
          {n}
        </p>
      ))}
    </Section>
  );
}
