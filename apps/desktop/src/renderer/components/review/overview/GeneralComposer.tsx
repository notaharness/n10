import { MessageSquarePlusIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import type { PullRequestRef } from '../../../../host/contract.js';
import { refocusAfter } from '../../../lib/focus.js';
import { useReviewDraft } from '../../../lib/review/review-drafts.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { CommentBody } from '../comments/CommentBody.js';
import { CommentComposer } from '../comments/CommentComposer.js';

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
  const place = (
    <span className="flex items-center gap-1.5">
      <Badge variant="outline" className="border-primary/40 text-primary">
        Your draft
      </Badge>
      Comment on the conversation
      <span className="text-muted-foreground">· Private to you</span>
    </span>
  );
  const hasText = draft.body.trim() !== '';

  if (open) {
    return (
      <CommentComposer
        draft={draft}
        place={place}
        primary="Keep as draft"
        placeholder="Write a comment… Markdown supported."
        onUndo={() => refocusAfter(() => prompt.current)}
        onClose={() => {
          setOpen(false);
          refocusAfter(() => card.current ?? prompt.current);
        }}
      />
    );
  }
  if (hasText) {
    return (
      <article
        ref={card}
        tabIndex={-1}
        data-my-draft="general"
        className="overflow-hidden rounded-lg border border-primary/30 bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <header className="flex items-center gap-2 border-b border-border bg-primary/5 px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1">{place}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit draft"
            onClick={() => setOpen(true)}
          >
            <PencilIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Discard draft"
            className="hover:text-destructive"
            onClick={() => {
              // `discard` never rejects.
              void draft
                .discard(() => refocusAfter(() => card.current))
                .then(() => refocusAfter(() => prompt.current));
            }}
          >
            <Trash2Icon />
          </Button>
        </header>
        <div className="px-3 py-2">
          <CommentBody markdown={draft.body} />
        </div>
      </article>
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
