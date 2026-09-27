import {
  AlertCircleIcon,
  CheckIcon,
  CornerDownRightIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { ComposerNotice as Notice } from '../../../lib/diff/thread-model.js';
import type { DurableDraft } from '../../../lib/review/review-drafts.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Textarea } from '../../ui/textarea.js';
import { ComposerNoticeLine } from './ComposerNotice.js';
import { DraftStatus, UnsavedChoice } from './DraftStatus.js';

/**
 * The card's reply box and resolve button. The reply is a durable
 * draft: closing the box keeps it, and a closed box with a draft says
 * so and opens on it.
 */
export function ThreadFooter({
  canResolve,
  isResolved,
  composing,
  setComposing,
  draft,
  sending,
  resolving,
  onSend,
  onToggleResolved,
  notice = null,
}: {
  canResolve: boolean;
  isResolved: boolean;
  composing: boolean;
  setComposing: (composing: boolean) => void;
  draft: DurableDraft;
  sending: boolean;
  resolving: boolean;
  onSend: (alsoResolve?: boolean) => void;
  onToggleResolved: () => void;
  /** Freshness line from `useComposerRefresh`, shown above the input. */
  notice?: Notice | null;
}) {
  return (
    <div className="flex items-start gap-2 border-t border-border bg-muted/20 px-3 py-2">
      {composing ? (
        <ReplyComposer
          canResolve={canResolve && !isResolved}
          draft={draft}
          sending={sending}
          notice={notice}
          onSend={onSend}
          onClose={() => setComposing(false)}
        />
      ) : (
        <ReplyPrompt draft={draft} onOpen={() => setComposing(true)} />
      )}
      {canResolve && !composing && (
        <Button
          variant={isResolved ? 'ghost' : 'outline'}
          size="sm"
          onClick={onToggleResolved}
          disabled={resolving}
        >
          {isResolved ? (
            <>
              <RotateCcwIcon /> Reopen
            </>
          ) : (
            <>
              <CheckIcon /> Resolve
            </>
          )}
        </Button>
      )}
    </div>
  );
}

/** The closed box: an invitation, or the reader's own unsent reply. */
function ReplyPrompt({
  draft,
  onOpen,
}: {
  draft: DurableDraft;
  onOpen: () => void;
}) {
  const firstLine = draft.body.trim().split('\n')[0];
  const unsaved = draft.save.kind === 'failed' && !!firstLine;
  return (
    <button
      type="button"
      onClick={onOpen}
      // Until the stored drafts are read, a box that looks empty may not
      // be: typing into it would replace a draft nobody has seen.
      disabled={draft.loading}
      title={draft.readError ?? undefined}
      className={cn(
        'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 text-left text-sm text-muted-foreground hover:border-ring disabled:opacity-60',
        unsaved ? 'border-destructive/60' : 'border-input'
      )}
    >
      {unsaved ? (
        <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
      ) : (
        <CornerDownRightIcon className="size-3.5 shrink-0" />
      )}
      {firstLine ? (
        <>
          <span
            className={cn(
              'shrink-0 font-medium',
              unsaved ? 'text-destructive' : 'text-foreground'
            )}
          >
            {unsaved ? 'Your reply isn’t saved' : 'Your draft reply'}
          </span>
          <span className="truncate">{firstLine}</span>
        </>
      ) : draft.readError ? (
        <span className="truncate text-destructive">
          Couldn't read your saved drafts
        </span>
      ) : (
        'Reply…'
      )}
    </button>
  );
}

function ReplyComposer({
  canResolve,
  draft,
  sending,
  notice,
  onSend,
  onClose,
}: {
  canResolve: boolean;
  draft: DurableDraft;
  sending: boolean;
  notice: Notice | null;
  onSend: (alsoResolve?: boolean) => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const empty = !draft.body.trim();
  // Closing keeps the draft: a save still running finishes on its own,
  // and the closed box says if it failed. Only a failed one asks first.
  const close = () => {
    if (draft.save.kind === 'failed' && !empty) setConfirming(true);
    else {
      draft.flush();
      onClose();
    }
  };
  return (
    <div className="flex flex-1 flex-col gap-2">
      <ComposerNoticeLine notice={notice} />
      <Textarea
        ref={box}
        autoFocus
        aria-label="Reply"
        value={draft.body}
        onChange={(e) => draft.setBody(e.target.value)}
        onBlur={draft.flush}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSend();
          }
          if (e.key === 'Escape') close();
        }}
        placeholder="Write a reply… Markdown supported. ⌘/Ctrl+Enter to send."
        className="min-h-20 bg-background"
      />
      {confirming ? (
        <UnsavedChoice
          draft={draft}
          onClose={onClose}
          onKeepEditing={() => {
            setConfirming(false);
            box.current?.focus();
          }}
        />
      ) : (
        <div className="flex items-center gap-2">
          <DraftStatus draft={draft} />
          <div className="ml-auto flex gap-2">
            {!empty && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  draft.discard().then(onClose, onClose);
                }}
              >
                <Trash2Icon /> Discard
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={close}>
              Close
            </Button>
            {canResolve && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSend(true)}
                disabled={sending || empty}
              >
                <CheckIcon /> Reply & resolve
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => onSend()}
              disabled={sending || empty}
            >
              {sending ? 'Sending…' : 'Reply'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
