import { SendIcon } from 'lucide-react';
import { useState } from 'react';
import { pullRequestRefFor } from '../../../lib/data/pr-snapshot-query.js';
import { useRepo } from '../../../lib/repo-context.js';
import type { PrDiffView } from '../../../lib/review/use-pr-diff.js';
import { Button } from '../../ui/button.js';
import { Popover, PopoverTrigger } from '../../ui/popover.js';
import { FinishReviewForm } from './FinishReviewForm.js';

/** The commit the diff on screen reaches: a chosen range's end, else
 *  the pull request's head; null while a choice shows nothing yet. */
function readHead({ revisions, comparison }: PrDiffView): string | null {
  if (revisions.pair) return revisions.pair.to;
  if (revisions.choice.mode !== 'all') return null;
  return comparison?.headOid ?? null;
}

/**
 * Where a review ends: beside the commits the diff compares, a button
 * that opens the form to file it. Absent where reviews can't be filed.
 */
export function FinishReview({
  prId,
  prDiff,
  providerHead,
}: {
  prId: number;
  /** The diff on screen: the review is filed on its head. */
  prDiff: PrDiffView | undefined;
  providerHead: string | undefined;
}) {
  const { repo } = useRepo();
  const [open, setOpen] = useState(false);
  const ref = pullRequestRefFor(repo, prId);
  if (!ref || !prDiff || repo.reviewEvents.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="h-7 shrink-0">
          <SendIcon />
          Finish review
        </Button>
      </PopoverTrigger>
      {open && (
        <FinishReviewForm
          prRef={ref}
          shownHead={readHead(prDiff)}
          ranged={prDiff.revisions.choice.mode === 'range'}
          providerHead={providerHead}
        />
      )}
    </Popover>
  );
}
