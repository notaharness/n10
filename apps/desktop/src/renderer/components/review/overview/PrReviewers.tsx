import {
  CheckCircle2Icon,
  CircleDashedIcon,
  ClockIcon,
  MinusCircleIcon,
  XCircleIcon,
} from 'lucide-react';
import { useId } from 'react';
import type { PullRequestReviewer, ReviewDecision } from '@n10/vcs-core/types';
import type {
  ReviewRequirements,
  StandingRule,
} from '../../../../host/contract.js';
import { DECISION_LABEL } from '../../../lib/review/overview-model.js';
import {
  reviewerRows,
  type ReviewerGroup,
  type ReviewerRow,
} from '../../../lib/review/reviewer-model.js';
import { cn } from '../../../lib/utils.js';
import { Avatar } from '../../ui/avatar.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.js';
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

/** Each rule keyed by what it says and which repeat it is: two policies
 *  can read the same. */
function keyed(rules: readonly StandingRule[]) {
  const seen = new Map<string, number>();
  return rules.map((rule) => {
    const says = JSON.stringify(rule);
    const n = (seen.get(says) ?? 0) + 1;
    seen.set(says, n);
    return { rule, key: `${says}#${n}` };
  });
}

/** The rules that name a reviewer, as the provider states them: each
 *  with what it asks and its paths, one a line. */
function RulesTip({ rules }: { rules: readonly StandingRule[] }) {
  return (
    <div data-reviewer-rules className="space-y-2 py-0.5">
      {keyed(rules).map(({ rule, key }) => (
        <div key={key}>
          <p className="font-medium">{rule.name}</p>
          <p className="text-xs text-muted-foreground">{rule.asks}</p>
          {rule.applies === false && (
            <p className="text-xs text-muted-foreground">
              Not applicable to these changes
            </p>
          )}
          {rule.paths.length > 0 && (
            <ul className="mt-1 font-mono text-xs">
              {rule.paths.map((path) => (
                <li key={path} className="break-all">
                  {path}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/** Required or optional and why, under the name; a rule behind it shows
 *  on hover or focus. */
function Standing({ row }: { row: ReviewerRow }) {
  if (!row.standing) return null;
  const text = 'block text-xs text-muted-foreground';
  if (row.rules.length === 0) {
    return (
      <span data-reviewer-standing className={text}>
        {row.standing}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-reviewer-standing
          className={cn(
            text,
            'cursor-default text-left underline decoration-dotted underline-offset-2 hover:text-foreground'
          )}
        >
          {row.standing}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-sm">
        <RulesTip rules={row.rules} />
      </TooltipContent>
    </Tooltip>
  );
}

function ReviewerItem({ row, me }: { row: ReviewerRow; me?: string }) {
  return (
    <li data-reviewer={row.identifier} className="flex items-start gap-2">
      <Avatar name={row.displayName} size="xs" className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate" title={row.displayName}>
          {row.displayName}
          {row.identifier.toLowerCase() === me && (
            <span className="text-muted-foreground"> (you)</span>
          )}
        </span>
        <Standing row={row} />
      </span>
      <Decision decision={row.decision} />
    </li>
  );
}

/** A group of reviewers; the optional ones under their own heading. */
function Group({ group, me }: { group: ReviewerGroup; me?: string }) {
  const id = useId();
  return (
    <div data-reviewer-group={group.title ?? 'required'}>
      {group.title && (
        <h3 id={id} className="mt-3 mb-1.5 text-xs text-muted-foreground">
          {group.title}
        </h3>
      )}
      <ul
        aria-labelledby={group.title ? id : undefined}
        className="space-y-1.5 text-sm"
      >
        {group.rows.map((r) => (
          <ReviewerItem key={r.identifier} row={r} me={me} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Everyone asked to review, each with their verdict in words: the
 * required first, then the optional under a heading, where the provider
 * says which is which. A row adds why they were asked, and the rules
 * that name them, with their paths, show on its hover. The list row
 * names them until the detail read, which also names teams, answers.
 */
export function PrReviewers({
  reviewers,
  requirements,
  viewer,
}: {
  reviewers: readonly PullRequestReviewer[];
  requirements: ReviewRequirements | null;
  viewer: string | null;
}) {
  const me = viewer?.toLowerCase();
  const { groups, notes } = reviewerRows(reviewers, requirements);
  const none = groups.every((g) => g.rows.length === 0);
  return (
    <Section title="Reviewers">
      {none ? (
        <p className="text-sm text-muted-foreground">No reviewers requested.</p>
      ) : (
        groups.map((g) => <Group key={g.title ?? ''} group={g} me={me} />)
      )}
      {notes.map((n) => (
        <p key={n} className="mt-2 text-xs text-muted-foreground">
          {n}
        </p>
      ))}
    </Section>
  );
}
