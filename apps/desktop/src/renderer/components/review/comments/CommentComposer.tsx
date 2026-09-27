import { Trash2Icon } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { DurableDraft } from '../../../lib/review/review-drafts.js';
import { Button } from '../../ui/button.js';
import { Textarea } from '../../ui/textarea.js';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.js';
import { CommentMarkdown } from './CommentMarkdown.js';
import { DraftStatus, UnsavedChoice } from './DraftStatus.js';

/**
 * A new comment, written as a private draft. The text is kept as it is
 * typed; the primary action says what it does ("Add to review") and
 * Mod+Enter does exactly that, nothing else. Escape closes and keeps
 * the text; only Discard lets it go. Preview renders what the provider
 * will be sent, and going back to Write keeps text and cursor.
 */
export function CommentComposer({
  draft,
  place,
  primary,
  placeholder,
  onClose,
  onUndo,
}: {
  draft: DurableDraft;
  /** Where the comment goes, in words, above the box. */
  place: ReactNode;
  primary: string;
  placeholder: string;
  /** The composer is done with: closed, added, or discarded. */
  onClose: () => void;
  /** A discarded comment came back: where focus goes then. */
  onUndo?: () => void;
}) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const empty = !draft.body.trim();
  const close = () => {
    if (draft.save.kind === 'failed' && !empty) {
      setConfirming(true);
      return;
    }
    draft.flush();
    onClose();
  };
  const write = () => {
    setMode('write');
    // The textarea mounts again; put the reader back where they were.
    requestAnimationFrame(() => box.current?.focus());
  };
  return (
    <div
      className="overflow-hidden rounded-lg border border-primary/40 bg-card font-sans text-card-foreground shadow-xs"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          if (!empty && !e.repeat) close();
        } else if (e.key === 'Escape' && !confirming) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate">{place}</span>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) =>
            v === 'write' ? write() : v && setMode('preview')
          }
          aria-label="Composer view"
          className="rounded-md border border-border p-0.5"
        >
          {(['write', 'preview'] as const).map((m) => (
            <ToggleGroupItem
              key={m}
              value={m}
              className="h-5 rounded px-1.5 capitalize text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground"
            >
              {m}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {mode === 'write' ? (
          <Textarea
            ref={box}
            autoFocus
            aria-label="Comment"
            value={draft.body}
            onChange={(e) => draft.setBody(e.target.value)}
            onBlur={draft.flush}
            placeholder={placeholder}
            className="min-h-24 bg-background"
          />
        ) : (
          <div className="min-h-24 rounded-md border border-border bg-background px-3 py-2">
            {empty ? (
              <p className="text-sm text-muted-foreground">
                Nothing to preview.
              </p>
            ) : (
              <CommentMarkdown markdown={draft.body} />
            )}
          </div>
        )}
        {confirming ? (
          <UnsavedChoice
            draft={draft}
            onClose={onClose}
            onUndo={onUndo}
            onKeepEditing={() => {
              setConfirming(false);
              write();
            }}
          />
        ) : (
          <div className="flex items-center gap-2">
            <DraftStatus draft={draft} />
            <div className="ml-auto flex gap-2">
              {empty ? (
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    draft.discard(onUndo).then(onClose, onClose);
                  }}
                >
                  <Trash2Icon /> Discard
                </Button>
              )}
              <Button size="sm" onClick={close} disabled={empty}>
                {primary}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
