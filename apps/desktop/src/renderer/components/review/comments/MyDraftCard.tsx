import { PencilIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { useRef } from 'react';
import { refocusAfter } from '../../../lib/focus.js';
import { rangeSource, rangeWords } from '../../../lib/diff/range-selection.js';
import { useMyDrafts } from '../../../lib/review/my-drafts-context.js';
import type { InlineTarget } from '../../../lib/review/my-drafts.js';
import { useReviewDraft } from '../../../lib/review/review-drafts.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { CommentBody } from './CommentBody.js';
import { CommentComposer } from './CommentComposer.js';

/**
 * The reviewer's own comment on code, before it is published: a card
 * saying whose it is, where it goes and that nobody else can see it,
 * or the composer while it is being written. Labelled so it is never
 * mistaken for a posted thread or an agent's finding.
 */
export function MyDraftCard({ target }: { target: InlineTarget }) {
  const scope = useMyDrafts();
  const draft = useReviewDraft(scope.ref, target);
  const { key, anchor } = target;
  const editing = scope.editing.has(key);
  const card = useRef<HTMLElement>(null);
  // Closed, the keyboard stays with the comment: on its card, or — when
  // nothing was kept — on the line (or file) it was about.
  const whereItWas = () =>
    document.querySelector<HTMLElement>(
      anchor.range
        ? `[data-file="${CSS.escape(anchor.path)}"][data-point="${
            anchor.range.side
          }:${anchor.range.end}"]`
        : `[aria-label="${CSS.escape(`Comment on ${anchor.path}`)}"]`
    );
  const toCard = () => refocusAfter(() => card.current);
  const where = anchor.range ? rangeWords(anchor.range) : 'whole file';
  const place = (
    <span className="flex min-w-0 items-center gap-1.5">
      <Badge variant="outline" className="border-primary/40 text-primary">
        Your draft
      </Badge>
      <span className="truncate font-mono">
        {anchor.path} · {where}
      </span>
      <span className="shrink-0 text-muted-foreground">· Private to you</span>
    </span>
  );

  if (editing) {
    return (
      <CommentComposer
        draft={draft}
        place={place}
        primary="Add to review"
        placeholder="Leave a comment… Markdown supported. ⌘/Ctrl+Enter adds it to your review."
        onUndo={toCard}
        onClose={() => {
          scope.setEditing(key, false);
          if (draft.body.trim()) return toCard();
          scope.dropFresh(key);
          refocusAfter(whereItWas);
        }}
      />
    );
  }
  if (!draft.body.trim()) return null;
  return (
    <article
      ref={card}
      tabIndex={-1}
      data-my-draft={key}
      className="overflow-hidden rounded-lg border border-primary/30 bg-card font-sans text-card-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <header className="flex items-center gap-2 border-b border-border bg-primary/5 px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1">{place}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit draft"
          onClick={() => scope.setEditing(key, true)}
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
            void draft.discard(toCard).then(() => {
              scope.dropFresh(key);
              refocusAfter(whereItWas);
            });
          }}
        >
          <Trash2Icon />
        </Button>
      </header>
      <CodeMoved target={target} />
      <div className="px-3 py-2">
        <CommentBody markdown={draft.body} />
      </div>
    </article>
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
