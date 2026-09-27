import { BotIcon, EyeOffIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type {
  ConversationActor,
  ConversationComment,
} from '../../../../host/contract.js';
import { hiddenLabel } from '../../../lib/review/activity-text.js';
import { cn, relativeTime } from '../../../lib/utils.js';
import { Avatar } from '../../ui/avatar.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { CommentBody } from '../comments/CommentBody.js';

/** "3h ago", with the exact time on hover and for assistive tech. */
export function When({ at }: { at: string | null }) {
  if (!at) return null;
  return (
    <time
      dateTime={at}
      title={new Date(at).toLocaleString()}
      className="shrink-0 text-muted-foreground"
    >
      {relativeTime(at)}
    </time>
  );
}

/** Who, as the provider names them. Nobody named is said so. */
export function ActorName({ actor }: { actor: ConversationActor | null }) {
  return (
    <span
      className={cn(
        'font-medium',
        actor ? 'text-foreground' : 'italic text-muted-foreground'
      )}
      title={actor?.identifier}
    >
      {actor?.displayName ?? 'Deleted account'}
    </span>
  );
}

export function ActorBadge({ actor }: { actor: ConversationActor | null }) {
  if (actor?.kind === 'bot') {
    return (
      <Badge variant="outline">
        <BotIcon /> Bot
      </Badge>
    );
  }
  return actor?.kind === 'system' ? (
    <Badge variant="outline">Azure DevOps</Badge>
  ) : null;
}

/**
 * Hidden on the provider by a moderator or its author. The text came
 * with the read; it stays folded until the reader chooses to see it,
 * and the label says why it is folded rather than looking empty.
 */
function Minimized({
  reason,
  children,
}: {
  reason: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <EyeOffIcon className="size-3.5" />
        {hiddenLabel(reason)}
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      </p>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function Body({ comment }: { comment: ConversationComment }) {
  if (comment.deleted) {
    return (
      <p className="text-sm italic text-muted-foreground">
        This comment was deleted.
      </p>
    );
  }
  if (comment.kind === 'system') {
    return <p className="text-sm text-muted-foreground">{comment.body}</p>;
  }
  const body = <CommentBody markdown={comment.body} />;
  return comment.minimized ? (
    <Minimized reason={comment.minimized.reason}>{body}</Minimized>
  ) : (
    body
  );
}

/** One comment: who, when, and what they wrote. */
export function ActivityComment({
  comment,
  highlighted = false,
}: {
  comment: ConversationComment;
  /** Matches the reader's search. */
  highlighted?: boolean;
}) {
  return (
    <div
      data-comment-id={comment.id}
      className={cn(
        'px-3 py-2',
        highlighted && 'bg-primary/5 ring-1 ring-inset ring-primary/30'
      )}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
        <Avatar name={comment.author?.displayName ?? '?'} size="xs" />
        <ActorName actor={comment.author} />
        <ActorBadge actor={comment.author} />
        <When at={comment.createdAt} />
        {comment.editedAt && (
          <span
            className="text-muted-foreground"
            title={`Edited ${new Date(comment.editedAt).toLocaleString()}`}
          >
            · edited
          </span>
        )}
        {comment.pending && (
          <Badge
            variant="info"
            title="Part of your review that you have not submitted"
          >
            Pending · only you
          </Badge>
        )}
      </div>
      <Body comment={comment} />
    </div>
  );
}
