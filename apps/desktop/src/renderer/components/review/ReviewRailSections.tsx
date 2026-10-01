import {
  ClipboardCheckIcon,
  ClipboardListIcon,
  Loader2Icon,
  SendIcon,
} from 'lucide-react';
import type { ReviewComment } from '../../../host/contract.js';
import { severityCounts } from '../../lib/diff/diff-model.js';
import { formatSeverityBreakdown } from '../../lib/review/severity.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';

/**
 * The stacked entries at the top of the review rail. Each is its own
 * component because each appears on its own condition — there is no
 * order or state shared between them, only a column.
 */

/** The way in to the draft walkthrough, plus a post-everything escape. */
export function ReviewReadySection({
  drafts,
  reviewActive,
  onReview,
  postingAll,
  onPostAll,
}: {
  drafts: ReviewComment[];
  reviewActive: boolean;
  onReview: () => void;
  postingAll: boolean;
  onPostAll: () => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <div className="shrink-0 border-b border-border px-2 py-2">
      <button
        type="button"
        onClick={onReview}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
          reviewActive
            ? 'border-primary bg-primary/10'
            : 'border-border hover:bg-sidebar-accent'
        )}
      >
        <ClipboardCheckIcon className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium">Review ready</span>
          <span className="block text-xs text-muted-foreground">
            {formatSeverityBreakdown(severityCounts(drafts))}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
          {drafts.length}
        </span>
      </button>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 w-full"
        onClick={onPostAll}
        disabled={postingAll}
      >
        {postingAll ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        Post all {drafts.length} draft{drafts.length === 1 ? '' : 's'}
      </Button>
    </div>
  );
}

/**
 * The comments queued for the agent. Hidden at zero, like "Review
 * ready" above it: an empty cart is not a thing to look at.
 */
export function PlanSection({
  planCount,
  planNoted,
  planActive,
  onPlan,
}: {
  planCount: number;
  planNoted: number;
  planActive: boolean;
  onPlan: () => void;
}) {
  if (planCount === 0) return null;
  return (
    <div className="shrink-0 border-b border-border px-2 py-2">
      <button
        type="button"
        onClick={onPlan}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
          planActive
            ? 'border-primary bg-primary/10'
            : 'border-border hover:bg-sidebar-accent'
        )}
      >
        <ClipboardListIcon className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium">Plan</span>
          <span className="block text-xs text-muted-foreground">
            {planCount} comment{planCount === 1 ? '' : 's'}
            {planNoted > 0 && ` · ${planNoted} with a note`}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
          {planCount}
        </span>
      </button>
    </div>
  );
}
