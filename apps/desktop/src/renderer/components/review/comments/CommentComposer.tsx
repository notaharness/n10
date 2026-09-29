import { Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DurableDraft } from '../../../lib/review/review-drafts.js';
import { Button } from '../../ui/button.js';
import { Textarea } from '../../ui/textarea.js';
import { Popover, PopoverAnchor } from '../../ui/popover.js';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.js';
import { CommentMarkdown } from './CommentMarkdown.js';
import { displayMentions } from '../../../lib/review/mention-query.js';
import { mentionNames } from '../../../lib/review/mention-search.js';
import { DraftStatus, UnsavedChoice } from './DraftStatus.js';
import { useMentionPicker } from './MentionPicker.js';

/**
 * A new comment, written as a private draft. The text is kept as it is
 * typed; the primary action says what it does ("Add to review") and
 * Mod+Enter does exactly that, nothing else. Escape closes and keeps
 * the text; only Discard lets it go. Preview renders what the provider
 * will be sent; the box stays mounted behind it, so going back to Write
 * keeps text, cursor and selection.
 */
export function CommentComposer({
  draft,
  place,
  primary,
  placeholder,
  onClose,
  onUndo,
  takeFocus,
}: {
  draft: DurableDraft;
  /** Where the comment goes, in words, above the box. */
  place: ReactNode;
  primary: string;
  placeholder: string;
  /** The composer is done with, and whether its text was kept: closed
   *  or added with text (true), cancelled empty or discarded (false). */
  onClose: (kept: boolean) => void;
  /** A discarded comment came back: where focus goes then. */
  onUndo?: () => void;
  /** Whether to take the keyboard on mounting; asked once. A composer
   *  in a virtual list mounts again as it scrolls back into view, and
   *  must not pull focus and the viewport to itself each time. */
  takeFocus?: () => boolean;
}) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentionPicker(draft, box);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    if (takeFocus?.() ?? true) box.current?.focus();
  });
  const empty = !draft.body.trim();
  // What the box held when it opened: emptying a saved draft and
  // closing is a discard, and gets the same Undo.
  const [opened] = useState(draft.body);
  const letGo = () => {
    // `discard` and `clear` never reject.
    if (opened.trim()) void draft.discard(onUndo, opened);
    // Whitespace is not a draft; leave nothing stored behind the Cancel.
    else if (draft.body) void draft.clear();
    onClose(false);
  };
  const close = () => {
    if (empty) return letGo();
    if (draft.save.kind === 'failed') return setConfirming(true);
    draft.flush();
    onClose(true);
  };
  const write = () => {
    setMode('write');
    // Shown again once the mode renders; its caret never moved.
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
        <Popover open={mode === 'write' && mentions.open}>
          <PopoverAnchor asChild>
            <Textarea
              ref={box}
              hidden={mode === 'preview'}
              {...mentions.inputProps}
              aria-label="Comment"
              value={draft.body}
              onChange={(e) => draft.setBody(e.target.value)}
              onBlur={draft.flush}
              placeholder={placeholder}
              className="min-h-24 bg-background"
            />
          </PopoverAnchor>
          {mode === 'write' && mentions.list}
        </Popover>
        {mode === 'preview' && (
          <div className="min-h-24 rounded-md border border-border bg-background px-3 py-2">
            {empty ? (
              <p className="text-sm text-muted-foreground">
                Nothing to preview.
              </p>
            ) : (
              <CommentMarkdown
                markdown={displayMentions(draft.body, mentionNames)}
              />
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
                <Button variant="ghost" size="sm" onClick={letGo}>
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    const gone = () => onClose(false);
                    draft.discard(onUndo).then(gone, gone);
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
