import { CornerDownRightIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  RemoteCommentReply,
  RemoteCommentThread,
} from '../../../../host/contract.js';
import {
  threadExpanded,
  threadLocation,
} from '../../../lib/diff/thread-model.js';
import { focusIsLost } from '../../../lib/focus.js';
import { cn, relativeTime } from '../../../lib/utils.js';
import { Avatar } from '../../ui/avatar.js';
import { Badge } from '../../ui/badge.js';
import { CommentBody, ConventionalLabels } from './CommentBody.js';
import { ThreadSummary } from './ThreadSummary.js';
import { PlanAttachment } from '../PlanControls.js';
import { ThreadFooter } from './ThreadFooter.js';
import { useThreadActions } from './use-thread-actions.js';

/**
 * One review thread. The root comment and every reply render as
 * distinct messages (own header, divider, replies tinted + indented)
 * inside one bordered card with a summary header and a reply footer.
 * Resolved threads start collapsed to the header; `focused` (thread
 * navigator, the unresolved count, the Overview's activity) expands
 * and outlines the card.
 */
export function ThreadCard({
  thread,
  prId,
  showLocation = false,
  focused = false,
}: {
  thread: RemoteCommentThread;
  prId: number;
  showLocation?: boolean;
  focused?: boolean;
}) {
  // Expansion: user toggles win until the card is (re)focused, at
  // which point it always opens. Resolved threads start collapsed.
  const [override, setOverride] = useState<boolean | null>(null);
  const [prevFocused, setPrevFocused] = useState(focused);
  if (focused !== prevFocused) {
    setPrevFocused(focused);
    if (focused) setOverride(null);
  }
  const expanded = threadExpanded(override, focused, thread.isResolved);
  const { planControls, footer } = useThreadActions(prId, thread, expanded);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focused) return;
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Keyboard focus that is lost on the way here — the Overview's
    // button goes hidden as it opens the diff — lands on the thread it
    // asked for. Focus that is somewhere visible, such as the diff
    // toolbar's next-comment button, stays there.
    if (focusIsLost()) ref.current?.focus({ preventScroll: true });
  }, [focused]);

  const root = thread.comments[0];
  if (!root) return null;
  const replies = thread.comments.slice(1);

  const location = threadLocation(thread);

  return (
    <div
      ref={ref}
      data-thread={thread.id}
      tabIndex={-1}
      role="article"
      aria-label={[`Thread by ${root.author}`, location]
        .filter(Boolean)
        .join(' on ')}
      className={cn(
        'group/card max-w-[900px] overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring',
        planControls.inPlan
          ? 'border-primary/40'
          : thread.isResolved
          ? 'border-success/30'
          : 'border-border',
        focused && 'ring-2 ring-primary/50'
      )}
    >
      <ThreadSummary
        thread={thread}
        author={root.author}
        preview={root.body}
        location={showLocation ? location : null}
        expanded={expanded}
        onToggle={() => setOverride(!expanded)}
        inPlan={planControls.inPlan}
        hasNote={planControls.note !== undefined}
        onTogglePlan={planControls.toggleInPlan}
        onNote={() => {
          setOverride(true);
          planControls.startNote();
        }}
      />

      {expanded && (
        <>
          <div className="divide-y divide-border">
            <Message comment={root} />
            {replies.map((r) => (
              <Message key={r.id} comment={r} reply />
            ))}
          </div>

          <PlanAttachment
            composing={planControls.composing}
            note={planControls.note}
            onSave={planControls.saveNote}
            onCancel={planControls.cancelNote}
            onEdit={planControls.startNote}
          />

          <ThreadFooter
            canResolve={thread.canResolve}
            isResolved={thread.isResolved}
            {...footer}
          />
        </>
      )}
    </div>
  );
}

/** One comment in a thread: author line, then the markdown body. */
function Message({
  comment,
  reply = false,
}: {
  comment: RemoteCommentReply;
  reply?: boolean;
}) {
  return (
    <article
      className={cn(
        'px-3 py-2.5',
        reply && 'border-l-[3px] border-l-border bg-muted/15 pl-4'
      )}
    >
      <header className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {reply && (
          <CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Avatar name={comment.author} size="sm" />
        <span className="font-medium">{comment.author}</span>
        <span className="text-muted-foreground">
          {reply ? 'replied' : 'commented'} {relativeTime(comment.createdAt)}
        </span>
        <ConventionalLabels markdown={comment.body} />
        {comment.isMinimized && (
          <Badge variant="outline" className="ml-auto">
            Hidden
          </Badge>
        )}
      </header>
      <div
        className={cn(reply ? 'pl-[calc(1.25rem+0.875rem+0.5rem)]' : 'pl-7')}
      >
        <CommentBody markdown={comment.body} labels={false} />
      </div>
    </article>
  );
}
