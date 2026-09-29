import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeOffIcon,
  MessageSquarePlusIcon,
} from 'lucide-react';
import type { CollapseReason } from '../../../lib/diff/diff-model.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';

const COLLAPSE_LABEL: Record<Exclude<CollapseReason, null>, string> = {
  large: 'large diff',
  lockfile: 'lockfile',
  generated: 'generated',
};

/** Sticky header for one file's diff: name, collapse, badges, Viewed. */
export function DiffFileHeader({
  filename,
  open,
  onToggleOpen,
  viewed,
  onToggleViewed,
  onCommentFile,
  collapseReason,
  draftCount,
  mineCount,
  openThreads,
  adds,
  dels,
}: {
  filename: string;
  open: boolean;
  onToggleOpen: () => void;
  viewed: boolean;
  onToggleViewed: () => void;
  /** Absent when the diff cannot take comments. */
  onCommentFile?: () => void;
  collapseReason: CollapseReason;
  draftCount: number;
  mineCount: number;
  openThreads: number;
  adds: number;
  dels: number;
}) {
  const slash = filename.lastIndexOf('/');
  const dir = slash >= 0 ? filename.slice(0, slash + 1) : '';
  const base = filename.slice(dir.length);

  return (
    <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-border bg-background/95 px-2 backdrop-blur">
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-mono text-sm">
          <span className="text-muted-foreground">{dir}</span>
          <span
            className={cn(
              'text-foreground',
              viewed && 'text-muted-foreground line-through'
            )}
          >
            {base}
          </span>
        </span>
      </button>
      <FileChips
        collapsed={!open ? collapseReason : null}
        draftCount={draftCount}
        mineCount={mineCount}
        openThreads={openThreads}
      />
      <span className="shrink-0 font-mono text-xs tabular-nums">
        <span className="text-success">+{adds}</span>{' '}
        <span className="text-destructive">−{dels}</span>
      </span>
      <FileCommentButton filename={filename} onClick={onCommentFile} />
      <Tip label={viewed ? 'Mark as not viewed' : 'Mark as viewed'}>
        <button
          type="button"
          onClick={onToggleViewed}
          className={cn(
            'ml-1 flex h-5 items-center gap-1 rounded border px-1.5 text-xs transition-colors',
            viewed
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-border text-muted-foreground hover:bg-accent'
          )}
        >
          {viewed ? (
            <CheckIcon className="size-3" />
          ) : (
            <EyeOffIcon className="size-3" />
          )}
          Viewed
        </button>
      </Tip>
    </div>
  );
}

/** Why the file is collapsed, and what waits in it. */
function FileChips({
  collapsed,
  draftCount,
  mineCount,
  openThreads,
}: {
  collapsed: CollapseReason;
  draftCount: number;
  mineCount: number;
  openThreads: number;
}) {
  return (
    <>
      {collapsed && (
        <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
          {COLLAPSE_LABEL[collapsed]}
        </span>
      )}
      {draftCount > 0 && (
        <span className="rounded-full border border-dashed border-border px-1.5 text-xs font-medium text-muted-foreground">
          {draftCount} draft{draftCount === 1 ? '' : 's'}
        </span>
      )}
      {mineCount > 0 && (
        <span className="rounded-full border border-primary/40 px-1.5 text-xs font-medium text-primary">
          {mineCount} yours
        </span>
      )}
      {openThreads > 0 && (
        <span className="rounded-full bg-warning/15 px-1.5 text-xs font-medium text-warning">
          {openThreads} open
        </span>
      )}
    </>
  );
}

/** A comment on the whole file: for a binary, a rename, or a point
 *  that is about no one line. */
function FileCommentButton({
  filename,
  onClick,
}: {
  filename: string;
  onClick: (() => void) | undefined;
}) {
  if (!onClick) return null;
  return (
    <Tip label="Comment on this file">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Comment on ${filename}`}
        data-file-comment={filename}
        onClick={onClick}
      >
        <MessageSquarePlusIcon />
      </Button>
    </Tip>
  );
}
