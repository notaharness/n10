import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeXmlIcon,
  MessageSquareIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ConversationThread } from '../../../../host/contract.js';
import { commentPreview } from '../../../lib/review/activity-text.js';
import { matchingComments } from '../../../lib/review/activity-model.js';
import {
  nativeStatus,
  threadPlace,
} from '../../../lib/review/thread-anchor.js';
import { cn } from '../../../lib/utils.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';
import { ThreadContext } from '../comments/ThreadContext.js';
import { ActivityComment, ActorName } from './ActivityComment.js';

/** Replies shown either side of a folded run in a long thread. */
const KEEP_LAST = 2;
const FOLD_AFTER = 4;

function StatusBadges({ thread }: { thread: ConversationThread }) {
  const native = nativeStatus(thread);
  const by = thread.status.resolvedBy?.displayName;
  return (
    <>
      {thread.isOutdated && <Badge variant="outline">Outdated</Badge>}
      {thread.status.resolved ? (
        <Badge variant="success" title={by ? `Resolved by ${by}` : undefined}>
          <CheckCircle2Icon />
          {native ?? 'Resolved'}
          {by && <span className="font-normal">· {by}</span>}
        </Badge>
      ) : (
        native && <Badge variant="outline">{native}</Badge>
      )}
    </>
  );
}

/**
 * A review thread in the activity: where it is, its status in the
 * provider's own words, the code it was written on, and every reply.
 * Resolved threads start folded, as they do in the diff. A search that
 * matches a reply opens the thread and marks it, however deep it is.
 */
export function ActivityThread({
  thread,
  query,
  onOpen,
}: {
  thread: ConversationThread;
  query: string;
  onOpen: (id: string, path: string | null) => void;
}) {
  const matches = matchingComments(
    { kind: 'thread', id: thread.id, at: null, thread },
    query
  );
  // Folded as it was when first shown: a thread someone resolves while
  // it is being read stays open rather than moving the list.
  const [expanded, setExpanded] = useState(() => !thread.status.resolved);
  // A search opens the threads it matches; folding one again holds for
  // that search only.
  const [foldedFor, setFoldedFor] = useState<string | null>(null);
  const searching = matches.size > 0;
  const open = searching ? foldedFor !== query : expanded;
  const toggle = () => {
    if (searching) setFoldedFor(open ? query : null);
    else setExpanded(!open);
  };
  return (
    <article
      data-thread-id={thread.id}
      className="overflow-hidden rounded-md border border-border"
    >
      <ThreadHeader
        thread={thread}
        open={open}
        onToggle={toggle}
        onOpen={onOpen}
      />
      {open && <ThreadBody thread={thread} matches={matches} />}
    </article>
  );
}

function ThreadHeader({
  thread,
  open,
  onToggle,
  onOpen,
}: {
  thread: ConversationThread;
  open: boolean;
  onToggle: () => void;
  onOpen: (id: string, path: string | null) => void;
}) {
  const place = threadPlace(thread) ?? 'Conversation';
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  const count = thread.comments.length;
  const root = thread.comments[0];
  return (
    <header
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm',
        thread.status.resolved ? 'bg-success/5' : 'bg-muted/40',
        open && 'border-b border-border'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {root && (
          <span className="shrink-0">
            <ActorName actor={root.author} />
          </span>
        )}
        <span className="truncate font-mono text-xs text-muted-foreground">
          {place}
        </span>
        {!open && root && (
          <span className="min-w-0 truncate text-muted-foreground">
            — {commentPreview(root)}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {count} comment{count === 1 ? '' : 's'}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1">
        <StatusBadges thread={thread} />
        <Tip label="Show this thread in the diff">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Show the thread on ${place} in the diff`}
            onClick={() => onOpen(thread.id, thread.anchor?.path ?? null)}
          >
            <CodeXmlIcon />
          </Button>
        </Tip>
      </span>
    </header>
  );
}

function ThreadBody({
  thread,
  matches,
}: {
  thread: ConversationThread;
  matches: Set<string>;
}) {
  const [root, ...replies] = thread.comments;
  const { anchor, coverage } = thread;
  return (
    <div>
      {anchor && (anchor.diffHunk || thread.isOutdated) && (
        <div className="px-3 pt-2">
          <ThreadContext anchor={anchor} />
        </div>
      )}
      <div className="divide-y divide-border">
        {root && (
          <ActivityComment comment={root} highlighted={matches.has(root.id)} />
        )}
        <Replies replies={replies} matches={matches} />
      </div>
      {!coverage.complete && (
        <p className="border-t border-border px-3 py-1.5 text-xs text-warning">
          {coverage.total == null
            ? `Showing the first ${coverage.loaded} comments; the rest did not load.`
            : `Showing ${coverage.loaded} of ${coverage.total} comments; the rest did not load.`}
        </p>
      )}
    </div>
  );
}

/** A long thread shows its first and last replies and folds the run
 *  between, unless a search is looking inside it. */
function Replies({
  replies,
  matches,
}: {
  replies: ConversationThread['comments'];
  matches: Set<string>;
}) {
  const [all, setAll] = useState(false);
  const fold = !all && matches.size === 0 && replies.length > FOLD_AFTER;
  const head = fold ? replies.slice(0, 1) : replies;
  const tail = fold ? replies.slice(-KEEP_LAST) : [];
  const hidden = replies.length - head.length - tail.length;
  // Unfolding moves the reader to the first reply it shows, so focus
  // does not fall back to the page when the button goes.
  const first = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);
  useEffect(() => {
    if (!revealed.current) return;
    revealed.current = false;
    first.current?.focus();
  });
  return (
    <>
      {head.map((c, i) =>
        i === 1 && all ? (
          <div
            key={c.id}
            ref={first}
            tabIndex={-1}
            className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ActivityComment comment={c} highlighted={matches.has(c.id)} />
          </div>
        ) : (
          <ActivityComment
            key={c.id}
            comment={c}
            highlighted={matches.has(c.id)}
          />
        )
      )}
      {fold && (
        <div className="px-3 py-1">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => {
              revealed.current = true;
              setAll(true);
            }}
          >
            Show {hidden} more repl{hidden === 1 ? 'y' : 'ies'}
          </Button>
        </div>
      )}
      {tail.map((c) => (
        <ActivityComment key={c.id} comment={c} />
      ))}
    </>
  );
}
