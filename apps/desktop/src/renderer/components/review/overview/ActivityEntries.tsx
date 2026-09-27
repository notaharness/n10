import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  GitCommitHorizontalIcon,
  FileDiffIcon,
  GitPullRequestIcon,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import type {
  ConversationEvent,
  ReviewSummary,
} from '../../../../host/contract.js';
import type {
  ActivityEntry,
  ActivityRow,
  CommitEvent,
} from '../../../lib/review/activity-model.js';
import {
  commitsSentence,
  eventSentence,
  reviewSentence,
  writesOwnActor,
} from '../../../lib/review/activity-text.js';
import { Avatar } from '../../ui/avatar.js';
import { Badge } from '../../ui/badge.js';
import { CommentBody } from '../comments/CommentBody.js';
import {
  ActivityComment,
  ActorBadge,
  ActorName,
  When,
} from './ActivityComment.js';
import { ActivityThread } from './ActivityThread.js';

type OpenThread = (id: string, path: string | null) => void;

/** The verdict's colour, carried by an icon beside the sentence that
 *  names it, so the state is never colour alone. */
const VERDICT_ICON: Partial<
  Record<ReviewSummary['state'], { Icon: LucideIcon; tone: string }>
> = {
  approved: { Icon: CheckCircle2Icon, tone: 'text-success' },
  'changes-requested': { Icon: FileDiffIcon, tone: 'text-warning' },
};

function ReviewEntry({ review }: { review: ReviewSummary }) {
  const verdict = VERDICT_ICON[review.state];
  return (
    <article className="overflow-hidden rounded-md border border-border">
      <header className="flex flex-wrap items-center gap-1.5 bg-muted/40 px-3 py-1.5 text-sm">
        <Avatar name={review.author?.displayName ?? '?'} size="xs" />
        <ActorName actor={review.author} />
        <ActorBadge actor={review.author} />
        {verdict && (
          <verdict.Icon className={`size-3.5 shrink-0 ${verdict.tone}`} />
        )}
        <span className="text-muted-foreground">{reviewSentence(review)}</span>
        {review.state === 'pending' && (
          <Badge variant="info">Pending · only you</Badge>
        )}
        {review.commit && (
          <span className="font-mono text-xs text-muted-foreground">
            at {review.commit.slice(0, 7)}
          </span>
        )}
        <span className="ml-auto text-xs">
          <When at={review.submittedAt} />
        </span>
      </header>
      {review.body.trim() && (
        <div className="border-t border-border px-3 py-2">
          {review.minimized ? (
            <p className="text-sm text-muted-foreground">
              Summary hidden
              {review.minimized.reason ? ` as ${review.minimized.reason}` : ''}.
            </p>
          ) : (
            <CommentBody markdown={review.body} />
          )}
        </div>
      )}
    </article>
  );
}

/** One line for something that happened: who, what, when. */
function EventLine({ event }: { event: ConversationEvent }) {
  const own = writesOwnActor(event);
  const Icon =
    event.kind === 'commit' ? GitCommitHorizontalIcon : GitPullRequestIcon;
  return (
    <div className="flex items-start gap-2 px-3 text-xs text-muted-foreground">
      <Icon className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {!own && (event.actor || event.kind === 'commit') && (
          <>
            {event.kind === 'commit' && !event.actor ? (
              <span className="font-medium text-foreground">
                {event.authorName ?? 'Someone'}
              </span>
            ) : (
              <ActorName actor={event.actor} />
            )}{' '}
          </>
        )}
        {eventSentence(event)}
      </span>
      <When at={event.at} />
    </div>
  );
}

function CommitsEntry({ events }: { events: CommitEvent[] }) {
  const [open, setOpen] = useState(false);
  const last = events.at(-1)!;
  const who = last.actor?.displayName ?? last.authorName ?? 'Someone';
  return (
    <div className="px-3 text-xs text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left hover:text-foreground"
      >
        <GitCommitHorizontalIcon className="size-3.5 shrink-0" />
        <span className="flex-1">
          <span className="font-medium text-foreground">{who}</span>{' '}
          {commitsSentence(events.length)}
        </span>
        <When at={last.at} />
        {open ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-5.5">
          {events.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="font-mono">{e.commit.slice(0, 7)}</span>
              <span className="truncate text-foreground">{e.headline}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryView({
  entry,
  query,
  onOpenThread,
}: {
  entry: ActivityEntry;
  query: string;
  onOpenThread: OpenThread;
}) {
  switch (entry.kind) {
    case 'review':
      return <ReviewEntry review={entry.review} />;
    case 'comment':
      return (
        <article className="overflow-hidden rounded-md border border-border">
          <ActivityComment comment={entry.comment} />
        </article>
      );
    case 'thread':
      return (
        <ActivityThread
          thread={entry.thread}
          query={query}
          onOpen={onOpenThread}
        />
      );
    case 'event':
      return <EventLine event={entry.event} />;
  }
}

/** Bot comments and provider noise, folded to one line with a count. */
function AutomationEntry({
  entries,
  query,
  onOpenThread,
}: {
  entries: ActivityEntry[];
  query: string;
  onOpenThread: OpenThread;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <BotIcon className="size-3.5 shrink-0" />
        <span className="flex-1">
          {entries.length} automated update{entries.length === 1 ? '' : 's'}
        </span>
        {open ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
      </button>
      {open && (
        <ol className="mt-2 space-y-2 border-l border-border pl-3">
          {entries.map((e) => (
            <li key={e.id}>
              <EntryView entry={e} query={query} onOpenThread={onOpenThread} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ActivityRowView({
  row,
  query,
  onOpenThread,
}: {
  row: ActivityRow;
  query: string;
  onOpenThread: OpenThread;
}) {
  if (row.kind === 'commits') return <CommitsEntry events={row.events} />;
  if (row.kind === 'automation') {
    return (
      <AutomationEntry
        entries={row.entries}
        query={query}
        onOpenThread={onOpenThread}
      />
    );
  }
  return <EntryView entry={row} query={query} onOpenThread={onOpenThread} />;
}
