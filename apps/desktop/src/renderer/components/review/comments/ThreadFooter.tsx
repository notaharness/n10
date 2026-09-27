import { CheckIcon, CornerDownRightIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import type { ComposerNotice as Notice } from '../../../lib/diff/thread-model.js';
import type { DurableDraft } from '../../../lib/review/review-drafts.js';
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
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm text-muted-foreground hover:border-ring"
    >
      <CornerDownRightIcon className="size-3.5 shrink-0" />
      {firstLine ? (
        <>
          <span className="shrink-0 font-medium text-foreground">
            Your draft reply
          </span>
          <span className="truncate">{firstLine}</span>
        </>
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
  const empty = !draft.body.trim();
  // Closing keeps the draft; only an unsaved one asks first.
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
          onKeepEditing={() => setConfirming(false)}
        />
      ) : (
        <div className="flex items-center gap-2">
          <DraftStatus draft={draft} />
          <div className="ml-auto flex gap-2">
            {!empty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  draft.discard().then(onClose, onClose);
                }}
              >
                Discard
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
