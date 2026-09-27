import {
  AlertCircleIcon,
  Loader2Icon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import type { ReviewDraft } from '../../../../host/contract.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { displayMentions } from '../../../lib/review/mention-query.js';
import { mentionNames } from '../../../lib/review/mention-search.js';
import { CommentBody } from './CommentBody.js';

/** Where a draft goes, marked as the reader's own and private. */
export function OwnDraftPlace({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Badge variant="outline" className="border-primary/40 text-primary">
        Your draft
      </Badge>
      {children}
      <span className="shrink-0 text-muted-foreground">· Private to you</span>
    </span>
  );
}

/**
 * The reviewer's own unpublished comment, closed: whose it is, where it
 * goes and that nobody else can see it, so it is never mistaken for a
 * posted thread or an agent's finding.
 */
export function OwnDraftCard({
  id,
  cardRef,
  place,
  body,
  notice,
  onEdit,
  onDiscard,
}: {
  /** Names the card for focus: `data-my-draft`. */
  id: string;
  cardRef?: Ref<HTMLElement>;
  place: ReactNode;
  body: string;
  /** Said above the body, such as the code having changed under it. */
  notice?: ReactNode;
  /** Absent while the draft is being posted: its text cannot change. */
  onEdit?: () => void;
  onDiscard?: () => void;
}) {
  return (
    <article
      ref={cardRef}
      tabIndex={-1}
      data-my-draft={id}
      className="overflow-hidden rounded-lg border border-primary/30 bg-card font-sans text-card-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <header className="flex items-center gap-2 border-b border-border bg-primary/5 px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1">{place}</span>
        {onEdit && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit draft"
            onClick={onEdit}
          >
            <PencilIcon />
          </Button>
        )}
        {onDiscard && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Discard draft"
            className="hover:text-destructive"
            onClick={onDiscard}
          >
            <Trash2Icon />
          </Button>
        )}
      </header>
      {notice}
      <div className="px-3 py-2">
        <CommentBody markdown={displayMentions(body, mentionNames)} />
      </div>
    </article>
  );
}

/**
 * Where posting a draft has got to, when it is anywhere: going out with
 * the review, maybe already posted (looked for before it is sent
 * again), or refused with the provider's reason.
 */
export function PostingNotice({
  sending,
  refused,
}: {
  sending: ReviewDraft | null;
  refused: string | null;
}) {
  const state = sending?.publication.state;
  if (!state && !refused) return null;
  const text =
    state === 'publishing'
      ? 'Posting with your review…'
      : state === 'unknown'
      ? 'This may already have been posted. n10 will check before sending it again.'
      : `Couldn't post: ${refused}`;
  return (
    <p
      role="status"
      className={
        refused && !state
          ? 'flex items-center gap-1.5 border-b border-border bg-destructive/5 px-3 py-1.5 text-xs text-destructive'
          : 'flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground'
      }
    >
      {state === 'publishing' ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <AlertCircleIcon className="size-3.5" />
      )}
      {text}
    </p>
  );
}
