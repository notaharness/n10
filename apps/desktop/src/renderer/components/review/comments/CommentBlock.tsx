import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../../host/contract.js';
import type { InlineTarget } from '../../../lib/review/my-drafts.js';
import { cn } from '../../../lib/utils.js';
import { DraftCard } from '../drafts/DraftCard.js';
import { MyDraftCard } from './MyDraftCard.js';
import { ThreadCard } from './ThreadCard.js';

/**
 * The drafts + threads that hang under a diff line. `indent` aligns the
 * block under the content column (unified rows) vs the pane edge
 * (split rows / context).
 */
export function CommentBlock({
  threads,
  drafts = [],
  mine = [],
  prId,
  headSha,
  focusId,
  indent = true,
}: {
  threads: RemoteCommentThread[];
  drafts?: ReviewComment[];
  /** The reviewer's own drafts, shown first: they are what is being
   *  written now. */
  mine?: InlineTarget[];
  prId: number;
  headSha?: string;
  focusId: string | null;
  indent?: boolean;
}) {
  if (threads.length + drafts.length + mine.length === 0) return null;
  return (
    <div
      className={cn(
        'space-y-2 border-y border-border bg-muted/30 py-2 pr-4 font-sans',
        indent ? 'pl-[5.5rem]' : 'pl-4'
      )}
    >
      {mine.map((m) => (
        <MyDraftCard key={m.key} target={m} />
      ))}
      {drafts.map((d) => (
        <DraftCard
          key={d.id}
          draft={d}
          prId={prId}
          headSha={headSha}
          focused={d.id === focusId}
        />
      ))}
      {threads.map((t) => (
        <ThreadCard
          key={t.id}
          thread={t}
          prId={prId}
          focused={t.id === focusId}
        />
      ))}
    </div>
  );
}

/** Comments whose anchor line isn't in the diff (outdated / out of hunk). */
export function OrphanBlock({
  threads,
  drafts,
  mine = [],
  prId,
  headSha,
  focusId,
}: {
  threads: RemoteCommentThread[];
  drafts: ReviewComment[];
  mine?: InlineTarget[];
  prId: number;
  headSha?: string;
  focusId: string | null;
}) {
  return (
    <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3 font-sans">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Comments on lines not in this diff
      </p>
      {mine.map((m) => (
        <MyDraftCard key={m.key} target={m} />
      ))}
      {drafts.map((d) => (
        <DraftCard
          key={d.id}
          draft={d}
          prId={prId}
          headSha={headSha}
          showLocation
          focused={d.id === focusId}
        />
      ))}
      {threads.map((t) => (
        <ThreadCard
          key={t.id}
          thread={t}
          prId={prId}
          showLocation
          focused={t.id === focusId}
        />
      ))}
    </div>
  );
}
