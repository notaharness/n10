import { useMemo, useState } from 'react';
import type { PullRequestRef, ReviewEvent } from '../../../host/contract.js';
import { useRepo } from '../repo-context.js';
import { useReviewDraft, useReviewDrafts } from './review-drafts.js';
import {
  approvalBlock,
  approves,
  defaultChoice,
  isFiled,
  fileableDrafts,
  missingWords,
  verdictOptions,
} from './review-submission.js';
import { useSubmitReview } from './use-submit-review.js';

const SUMMARY = { kind: 'summary' } as const;

/**
 * The Finish review form's state: the summary (the stored summary
 * draft, autosaved), the verdict, the comments chosen — all of them
 * until the reviewer says otherwise — and why Submit cannot go yet.
 */
export function useFinishReview(
  prRef: PullRequestRef,
  shownHead: string | null,
  providerHead: string | undefined,
  ranged: boolean
) {
  const { repo } = useRepo();
  const summary = useReviewDraft(prRef, SUMMARY);
  const drafts = useReviewDrafts(prRef).data?.drafts;
  const items = useMemo(
    () => fileableDrafts(drafts ?? [], shownHead),
    [drafts, shownHead]
  );
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const chosen = picked ?? new Set(defaultChoice(items));
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const options = verdictOptions(repo.reviewEvents);
  const block = approvalBlock(shownHead, providerHead, ranged);
  const blocked = new Map<string, string>(
    block
      ? options.filter((o) => approves(o.event)).map((o) => [o.event, block])
      : []
  );
  const { outcome, submit } = useSubmitReview(prRef);
  const filed = isFiled(outcome);
  const missing = missingWords(
    event,
    summary.body.trim() !== '' || chosen.size > 0
  );
  const pending = outcome.kind === 'pending';
  return {
    providerId: repo.providerId,
    summary,
    items,
    chosen,
    toggle(id: string, on: boolean) {
      const next = new Set(chosen);
      if (on) next.add(id);
      else next.delete(id);
      setPicked(next);
    },
    options,
    event,
    setEvent,
    blocked,
    outcome,
    pending,
    filed,
    missing,
    canSubmit:
      !pending && shownHead !== null && missing === null && !blocked.has(event),
    async submit() {
      if (!shownHead) return;
      summary.flush();
      await submit(
        {
          head: shownHead,
          event,
          summary: summary.body,
          draftIds: [...chosen],
        },
        // Posted with the review: the next one starts a new summary.
        summary.forget
      );
    },
  };
}
