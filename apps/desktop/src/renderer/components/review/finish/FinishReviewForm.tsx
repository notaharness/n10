import { useId } from 'react';
import type { PullRequestRef, ReviewEvent } from '../../../../host/contract.js';
import { submitLabel } from '../../../lib/review/review-submission.js';
import { useFinishReview } from '../../../lib/review/use-finish-review.js';
import { Button } from '../../ui/button.js';
import { PopoverClose, PopoverContent } from '../../ui/popover.js';
import { Textarea } from '../../ui/textarea.js';
import { DraftChoice, SubmitNotice, VerdictField } from './FinishParts.js';

type Form = ReturnType<typeof useFinishReview>;

function Summary({ form }: { form: Form }) {
  const { summary } = form;
  return (
    <Textarea
      aria-label="Summary"
      value={summary.body}
      onChange={(e) => summary.setBody(e.target.value)}
      disabled={form.pending || form.filed || summary.sending !== null}
      placeholder="Leave a comment"
      rows={3}
    />
  );
}

function Footer({ form }: { form: Form }) {
  const id = useId();
  const why = form.filed ? null : form.missing;
  return (
    <div className="flex items-center gap-2">
      <p id={id} className="min-w-0 flex-1 text-xs text-muted-foreground">
        {why}
      </p>
      <PopoverClose asChild>
        <Button variant="ghost" size="sm" disabled={form.pending}>
          {form.filed ? 'Done' : 'Cancel'}
        </Button>
      </PopoverClose>
      {!form.filed && (
        <Button
          size="sm"
          onClick={() => void form.submit()}
          disabled={!form.canSubmit}
          aria-describedby={why ? id : undefined}
        >
          {form.pending ? 'Submitting…' : submitLabel(form.event)}
        </Button>
      )}
    </div>
  );
}

/**
 * Finishing a review, anchored to the button that opened it: the
 * summary, the verdict in the provider's terms, the comments that go
 * with it, and the verdict's own button, which files all of it as one
 * review on the commit the reader read.
 */
export function FinishReviewForm({
  prRef,
  shownHead,
  providerHead,
  ranged,
}: {
  prRef: PullRequestRef;
  /** The head the diff on screen was read at; null before it is read. */
  shownHead: string | null;
  /** The pull request's head as the provider reports it now. */
  providerHead: string | undefined;
  /** The reader chose the two revisions, the later at `shownHead`: the
   *  remedy is another choice, not loading new commits. */
  ranged: boolean;
}) {
  const title = useId();
  const form = useFinishReview(prRef, shownHead, providerHead, ranged);
  // A submit under way is not abandoned by a stray click or Escape.
  const hold = (e: Event) => {
    if (form.pending) e.preventDefault();
  };
  return (
    <PopoverContent
      align="end"
      sideOffset={6}
      collisionPadding={12}
      aria-labelledby={title}
      onEscapeKeyDown={hold}
      onInteractOutside={hold}
      className="grid max-h-(--radix-popover-content-available-height) w-[min(26rem,calc(100vw-1.5rem))] gap-3 overflow-y-auto p-3"
    >
      <h2 id={title} className="text-sm font-semibold">
        Finish your review
      </h2>
      <Summary form={form} />
      <VerdictField
        options={form.options}
        value={form.event}
        onChange={(e) => form.setEvent(e as ReviewEvent)}
        blocked={form.blocked}
      />
      <DraftChoice
        items={form.items}
        chosen={form.chosen}
        onToggle={form.toggle}
      />
      <SubmitNotice outcome={form.outcome} providerId={form.providerId} />
      <Footer form={form} />
    </PopoverContent>
  );
}
