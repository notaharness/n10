import { AlertCircleIcon, CheckIcon, Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import type { DurableDraft } from '../../../lib/review/review-drafts.js';
import { copyText } from '../../../lib/copy-text.js';
import { Button } from '../../ui/button.js';

/**
 * Whether what is in the box is kept. Saving and saved are quiet chrome,
 * not announced at every pause in typing; a failed save is an alert
 * that says why, in words, on screen.
 */
export function DraftStatus({ draft }: { draft: DurableDraft }) {
  const { save } = draft;
  if (!draft.durable || !draft.body) return null;
  if (save.kind === 'failed') {
    return (
      <span
        role="alert"
        className="flex min-w-0 items-start gap-1.5 text-xs text-destructive"
      >
        <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
        <span className="min-w-0 break-words">
          Couldn't save draft: {save.error}.{' '}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={draft.retry}
          >
            Retry
          </Button>
        </span>
      </span>
    );
  }
  return (
    <span
      data-draft-status={save.kind}
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      {save.kind === 'saving' ? (
        <>
          <Loader2Icon className="size-3 animate-spin" /> Saving draft…
        </>
      ) : (
        <>
          <CheckIcon className="size-3" /> Draft saved
        </>
      )}
    </span>
  );
}

/**
 * Asked instead of closing when the text is not saved: keep trying,
 * keep it somewhere else, or let it go. Escape goes back to editing.
 */
export function UnsavedChoice({
  draft,
  onClose,
  onKeepEditing,
  onUndo,
}: {
  draft: DurableDraft;
  /** Told whether the text was kept (a retry landed) or let go. */
  onClose: (kept: boolean) => void;
  onKeepEditing: () => void;
  onUndo?: () => void;
}) {
  // Once a retry lands there is nothing left to decide.
  const kept = draft.save.kind === 'saved';
  useEffect(() => {
    if (kept) onClose(true);
  }, [kept, onClose]);
  const retrying = draft.save.kind === 'saving';
  return (
    <div
      role="group"
      aria-label="This draft isn't saved"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onKeepEditing();
        }
      }}
      className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs"
    >
      <span className="mr-auto text-destructive">
        This draft isn't saved. Copy it, or discard it.
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={draft.retry}
        disabled={retrying}
      >
        {retrying ? (
          <>
            <Loader2Icon className="animate-spin" /> Retrying…
          </>
        ) : (
          'Retry'
        )}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => copyText(draft.body, 'Draft copied')}
      >
        Copy text
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const gone = () => onClose(false);
          draft.discard(onUndo).then(gone, gone);
        }}
      >
        Discard
      </Button>
      <Button size="sm" autoFocus onClick={onKeepEditing}>
        Keep editing
      </Button>
    </div>
  );
}
