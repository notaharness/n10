import { MessageSquarePlusIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import type { PullRequestRef } from '../../../../host/contract.js';
import { refocusAfter } from '../../../lib/focus.js';
import { useReviewDraft } from '../../../lib/review/review-drafts.js';
import { CommentComposer } from '../comments/CommentComposer.js';
import { OwnDraftCard, OwnDraftPlace } from '../comments/OwnDraftCard.js';

const GENERAL = { kind: 'general' } as const;

/**
 * A new comment on the pull request's conversation, written as a
 * private draft. It is offered even when nobody has commented yet.
 * Closed, a draft shows as the reader's own card; nothing is posted.
 */
export function GeneralComposer({ prRef }: { prRef: PullRequestRef }) {
  const draft = useReviewDraft(prRef, GENERAL);
  const [open, setOpen] = useState(false);
  const prompt = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);
  const place = <OwnDraftPlace>Comment on the conversation</OwnDraftPlace>;
  // The text is back, so the card is what renders.
  const toCard = () => refocusAfter(() => card.current);

  if (open) {
    return (
      <CommentComposer
        draft={draft}
        place={place}
        primary="Keep as draft"
        placeholder="Write a comment… Markdown supported. ⌘/Ctrl+Enter keeps it as a draft."
        onUndo={toCard}
        onClose={(kept) => {
          setOpen(false);
          refocusAfter(() => (kept ? card.current : prompt.current));
        }}
      />
    );
  }
  if (draft.body.trim()) {
    return (
      <OwnDraftCard
        id="general"
        cardRef={card}
        place={place}
        body={draft.body}
        onEdit={() => setOpen(true)}
        // `discard` never rejects.
        onDiscard={() =>
          void draft
            .discard(toCard)
            .then(() => refocusAfter(() => prompt.current))
        }
      />
    );
  }
  return (
    <button
      ref={prompt}
      type="button"
      onClick={() => setOpen(true)}
      disabled={draft.loading}
      className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-muted-foreground hover:border-ring disabled:opacity-60"
    >
      <MessageSquarePlusIcon className="size-4" />
      Write a comment…
    </button>
  );
}
