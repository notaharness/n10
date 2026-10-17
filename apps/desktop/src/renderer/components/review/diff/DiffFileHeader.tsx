import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeOffIcon,
  MessageSquarePlusIcon,
} from 'lucide-react';
import type { Ref } from 'react';
import type { PrDiffManifestFile } from '../../../../host/contract.js';
import type { CollapseReason } from '../../../lib/diff/diff-model.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';
import { ChangeKind } from './ChangeKind.js';

const COLLAPSE_LABEL: Record<Exclude<CollapseReason, null>, string> = {
  large: 'large diff',
  lockfile: 'lockfile',
  generated: 'generated',
};

/** Sticky header for one file's diff: name, collapse, badges, Viewed. */
export function DiffFileHeader({
  filename,
  change,
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
  binary = false,
  readable = true,
  toggleRef,
}: {
  filename: string;
  /** What git says happened to the file; absent for a worktree diff. */
  change?: Pick<PrDiffManifestFile, 'status' | 'oldPath'>;
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
  /** Null when not counted: see `FileStats`. */
  adds: number | null;
  dels: number | null;
  /** Git counts no lines for binary content. */
  binary?: boolean;
  /** Its lines are in hand, or it has none to read. A file not read
   *  cannot be marked viewed: nobody has seen it. */
  readable?: boolean;
  toggleRef?: Ref<HTMLButtonElement>;
}) {
  const canView = viewed || readable;
  const slash = filename.lastIndexOf('/');
  const dir = slash >= 0 ? filename.slice(0, slash + 1) : '';
  const base = filename.slice(dir.length);

  return (
    <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-border bg-background/95 px-2 backdrop-blur">
      <button
        ref={toggleRef}
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
        {change && (
          <ChangeKind status={change.status} oldPath={change.oldPath} />
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
      <HeaderBadges
        collapseReason={open ? null : collapseReason}
        draftCount={draftCount}
        mineCount={mineCount}
        openThreads={openThreads}
      />
      <LineCounts adds={adds} dels={dels} binary={binary} />
      <FileCommentButton filename={filename} onClick={onCommentFile} />
      <Tip label={viewTip(viewed, canView)}>
        <button
          type="button"
          onClick={canView ? onToggleViewed : undefined}
          aria-disabled={!canView}
          aria-pressed={viewed}
          className={cn(
            'ml-1 flex h-5 items-center gap-1 rounded border px-1.5 text-xs transition-colors aria-disabled:opacity-50',
            viewed
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-border text-muted-foreground not-aria-disabled:hover:bg-accent'
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

function viewTip(viewed: boolean, canView: boolean): string {
  if (!canView) return 'Load this file to mark it viewed';
  return viewed ? 'Mark as not viewed' : 'Mark as viewed';
}

function LineCounts({
  adds,
  dels,
  binary,
}: {
  adds: number | null;
  dels: number | null;
  binary: boolean;
}) {
  if (binary) {
    return (
      <span className="shrink-0 text-xs text-muted-foreground">binary</span>
    );
  }
  if (adds === null || dels === null) {
    return (
      <span
        className="shrink-0 text-xs text-muted-foreground"
        title="Not counted: Git’s file list was cut first"
      >
        —
      </span>
    );
  }
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      <span className="text-success">+{adds}</span>{' '}
      <span className="text-destructive">−{dels}</span>
    </span>
  );
}

/** Why a file is folded away, and what is waiting in it. */
function HeaderBadges({
  collapseReason,
  draftCount,
  mineCount,
  openThreads,
}: {
  collapseReason: CollapseReason;
  draftCount: number;
  mineCount: number;
  openThreads: number;
}) {
  return (
    <>
      {collapseReason && (
        <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
          {COLLAPSE_LABEL[collapseReason]}
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
