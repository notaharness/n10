import { AlertCircleIcon, CheckIcon, Loader2Icon } from 'lucide-react';
import type { DurableDraft } from '../../../lib/review/review-drafts.js';
import { copyText } from '../../../lib/copy-text.js';
import { Button } from '../../ui/button.js';

/**
 * Whether what is in the box is kept. Muted while it is, loud when a
 * save failed — then the text exists only on screen, and closing the
 * box would lose it.
 */
export function DraftStatus({ draft }: { draft: DurableDraft }) {
  const { save } = draft;
  if (!draft.durable || !draft.body) {
    return <span role="status" className="sr-only" />;
  }
  if (save.kind === 'failed') {
    return (
      <span
        role="status"
        className="flex min-w-0 items-center gap-1.5 text-xs text-destructive"
        title={save.error}
      >
        <AlertCircleIcon className="size-3.5 shrink-0" />
        <span className="truncate">Couldn't save draft</span>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={draft.retry}
        >
          Retry
        </Button>
      </span>
    );
  }
  return (
    <span
      role="status"
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
 * Asked instead of closing when the text is not saved: the reader
 * chooses to keep it somewhere, or to let it go.
 */
export function UnsavedChoice({
  draft,
  onClose,
  onKeepEditing,
}: {
  draft: DurableDraft;
  onClose: () => void;
  onKeepEditing: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="This draft isn't saved"
      className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs"
    >
      <span className="mr-auto text-destructive">
        This draft isn't saved. Copy it, or discard it.
      </span>
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
          draft.discard().then(onClose, onClose);
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
