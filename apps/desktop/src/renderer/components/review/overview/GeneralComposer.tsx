import { MessageSquarePlusIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PullRequestRef } from '../../../../host/contract.js';
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
  // Where the keyboard goes once what replaces the control that had it
  // is drawn: the card when the text comes back (Undo, Keep as draft),
  // the prompt when it goes. The control itself — the composer, the
  // toast's button — is gone by then or about to be, and what it would
  // hand focus back to may be gone too.
  const focusTo = useRef<'card' | 'prompt' | null>(null);
  useEffect(() => {
    const target = focusTo.current === 'card' ? card.current : prompt.current;
    if (!focusTo.current || !target || target.matches(':disabled')) return;
    focusTo.current = null;
    target.focus({ preventScroll: true });
  });
  const toCard = () => {
    focusTo.current = 'card';
  };

  if (open) {
    return (
      <CommentComposer
        draft={draft}
        place={place}
        primary="Keep as draft"
        placeholder="Write a comment… Markdown supported. ⌘/Ctrl+Enter keeps it as a draft."
        onUndo={toCard}
        onClose={(kept) => {
          focusTo.current = kept ? 'card' : 'prompt';
          setOpen(false);
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
        onDiscard={() => {
          focusTo.current = 'prompt';
          // `discard` never rejects.
          void draft.discard(toCard);
        }}
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
