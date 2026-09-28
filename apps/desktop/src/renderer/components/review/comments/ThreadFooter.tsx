import { CheckIcon, CornerDownRightIcon, RotateCcwIcon } from 'lucide-react';
import type { ComposerNotice as Notice } from '../../../lib/diff/thread-model.js';
import { Button } from '../../ui/button.js';
import { Textarea } from '../../ui/textarea.js';
import { ComposerNoticeLine } from './ComposerNotice.js';

interface FooterProps {
  /** The provider lets the viewer reply; true unless it says not. */
  canReply?: boolean;
  canResolve: boolean;
  isResolved: boolean;
  composing: boolean;
  setComposing: (composing: boolean) => void;
  draft: string;
  setDraft: (draft: string) => void;
  sending: boolean;
  resolving: boolean;
  onSend: (alsoResolve?: boolean) => void;
  onToggleResolved: () => void;
  /** Freshness line from `useComposerRefresh`, shown above the input. */
  notice?: Notice | null;
}

/** The card's reply box and resolve button, each where the provider
 *  lets the viewer use it. */
export function ThreadFooter(props: FooterProps) {
  const { canReply = true, canResolve, composing, setComposing } = props;
  return (
    <div className="flex items-start gap-2 border-t border-border bg-muted/20 px-3 py-2">
      {composing ? (
        <Composer {...props} />
      ) : canReply ? (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="flex h-7 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm text-muted-foreground hover:border-ring"
        >
          <CornerDownRightIcon className="size-3.5" />
          Reply…
        </button>
      ) : (
        <span className="flex-1" />
      )}
      {canResolve && !composing && <ResolveButton {...props} />}
    </div>
  );
}

function Composer({
  canResolve,
  isResolved,
  setComposing,
  draft,
  setDraft,
  sending,
  onSend,
  notice = null,
}: FooterProps) {
  const empty = sending || !draft.trim();
  return (
    <div className="flex flex-1 flex-col gap-2">
      <ComposerNoticeLine notice={notice} />
      <Textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSend();
          }
          if (e.key === 'Escape') setComposing(false);
        }}
        placeholder="Write a reply… Markdown supported. ⌘/Ctrl+Enter to send."
        className="min-h-20 bg-background"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setComposing(false)}>
          Cancel
        </Button>
        {canResolve && !isResolved && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSend(true)}
            disabled={empty}
          >
            <CheckIcon /> Reply & resolve
          </Button>
        )}
        <Button size="sm" onClick={() => onSend()} disabled={empty}>
          {sending ? 'Sending…' : 'Reply'}
        </Button>
      </div>
    </div>
  );
}

function ResolveButton({
  isResolved,
  resolving,
  onToggleResolved,
}: FooterProps) {
  return (
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
  );
}
