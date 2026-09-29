import { TriangleAlertIcon } from 'lucide-react';
import { rangeSource, rangeWords } from '../../../lib/diff/range-selection.js';
import { useMyDrafts } from '../../../lib/review/my-drafts-context.js';
import type { InlineTarget } from '../../../lib/review/my-drafts.js';
import { useReviewDraft } from '../../../lib/review/review-drafts.js';
import { CommentComposer } from './CommentComposer.js';
import { OwnDraftCard, OwnDraftPlace } from './OwnDraftCard.js';

/**
 * The reviewer's own comment on code, before it is published: its card,
 * or the composer while it is being written. Closed, the keyboard stays
 * with the comment: on its card, or — when nothing was kept — on the
 * line (or file) it was about, in this diff.
 */
export function MyDraftCard({ target }: { target: InlineTarget }) {
  const scope = useMyDrafts();
  const draft = useReviewDraft(scope.ref, target);
  const { key, anchor } = target;
  const where = anchor.range ? rangeWords(anchor.range) : 'whole file';
  const place = (
    <OwnDraftPlace>
      <span className="truncate font-mono">
        {anchor.path} · {where}
      </span>
    </OwnDraftPlace>
  );
  // Undo brings the text back before its save lands: show the card now.
  const undone = () => {
    scope.restore(target);
    scope.focusDraft(key);
  };
  const gone = () => {
    scope.dropFresh(key);
    scope.focusAnchor(target);
  };

  if (scope.editing.has(key)) {
    return (
      <CommentComposer
        draft={draft}
        place={place}
        primary="Add to review"
        placeholder="Leave a comment… Markdown supported. ⌘/Ctrl+Enter adds it to your review."
        takeFocus={() => scope.takeFocus(key)}
        onUndo={undone}
        onClose={(kept) => {
          scope.closeComposer(key);
          if (kept) scope.focusDraft(key);
          else gone();
        }}
      />
    );
  }
  if (!draft.body.trim()) return null;
  return (
    <OwnDraftCard
      id={key}
      place={place}
      body={draft.body}
      notice={<CodeMoved target={target} />}
      onEdit={() => scope.openComposer(target)}
      // `discard` never rejects.
      onDiscard={() => void draft.discard(undone).then(gone)}
    />
  );
}

/** Said when the lines under the draft are no longer the ones it was
 *  written on: the same line numbers now hold other code. */
function CodeMoved({ target }: { target: InlineTarget }) {
  const { linesOf } = useMyDrafts();
  const { anchor } = target;
  const lines = linesOf(anchor.path);
  if (!anchor.range || !lines) return null;
  const now = rangeSource(lines, anchor.range);
  if (now.join('\n') === anchor.lines.join('\n')) return null;
  return (
    <div className="border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-warning">
      <p className="flex items-center gap-1.5 font-medium">
        <TriangleAlertIcon className="size-3.5" /> The code here changed since
        you wrote this. It was:
      </p>
      <pre className="mt-1 overflow-x-auto font-mono text-foreground">
        {anchor.lines.join('\n')}
      </pre>
    </div>
  );
}
