import {
  ChevronDownIcon,
  ChevronUpIcon,
  ColumnsIcon,
  EyeOffIcon,
  FileIcon,
  MessageSquareIcon,
  RowsIcon,
  WrapTextIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  setDiffOptions,
  useDiffOptions,
  type DiffOptions,
} from '../../../lib/diff/diff-options.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';

/**
 * One row, wrapping when narrow: the comparison the diff is reading,
 * its settings — view, wrap, hide resolved, one file at a time — and
 * comment navigation, with the way to finish the review apart at the
 * end. Only diff-specific controls live here; the pull request's own
 * details are in the tab header, so this bar goes when the terminal
 * replaces the pane.
 *
 * Finish review stays at the top of the row's end, where the Overview
 * puts Review changes (`OverviewPane`'s `HEAD`): the bar's 40 px and
 * this row's 6 px above it, and 24 px inside the 10 px the Overview
 * keeps for its scrollbar to its right.
 */
export function DiffToolbar({
  comparison,
  finish,
  navCount,
  navIndex,
  onPrev,
  onNext,
  onToggleLayout,
}: {
  /** Which changes are on screen, for a pull request. */
  comparison?: ReactNode;
  /** The way to file the review, for a pull request. */
  finish?: ReactNode;
  navCount: number;
  navIndex: number;
  onPrev: () => void;
  onNext: () => void;
  /** Continuous ↔ one file at a time, keeping the reader's file. */
  onToggleLayout: () => void;
}) {
  const o = useDiffOptions();
  const single = o.layout === 'single';
  return (
    <div
      data-testid="diff-toolbar"
      className="flex shrink-0 items-start gap-4 border-b border-border py-1.5 pr-[34px] pl-2 text-sm"
    >
      <div className="flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {comparison}
        <div className="flex items-center gap-1">
          <ViewSwitch view={o.view} />
          <Toggle
            pressed={o.wrap}
            tip={o.wrap ? 'Disable line wrapping' : 'Wrap long lines'}
            onClick={() => setDiffOptions({ wrap: !o.wrap })}
          >
            <WrapTextIcon /> Wrap
          </Toggle>
          <Toggle
            pressed={o.hideResolved}
            tip={
              o.hideResolved ? 'Show resolved threads' : 'Hide resolved threads'
            }
            onClick={() => setDiffOptions({ hideResolved: !o.hideResolved })}
          >
            <EyeOffIcon /> Hide resolved
          </Toggle>
          <Toggle
            pressed={single}
            tip={single ? 'Show all files' : 'Show one file at a time'}
            onClick={onToggleLayout}
          >
            <FileIcon /> One file
          </Toggle>
        </div>
        {navCount > 0 && (
          <CommentStepper
            count={navCount}
            index={navIndex}
            onPrev={onPrev}
            onNext={onNext}
          />
        )}
      </div>
      {finish}
    </div>
  );
}

function Toggle({
  pressed,
  tip,
  onClick,
  children,
}: {
  pressed: boolean;
  tip: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tip label={tip}>
      <Button
        variant={pressed ? 'secondary' : 'ghost'}
        size="sm"
        onClick={onClick}
        aria-pressed={pressed}
      >
        {children}
      </Button>
    </Tip>
  );
}

function ViewSwitch({ view }: { view: DiffOptions['view'] }) {
  const option = (value: DiffOptions['view']) =>
    cn(
      'flex h-5 items-center gap-1 rounded px-1.5 text-xs',
      view === value
        ? 'bg-accent text-foreground'
        : 'text-muted-foreground hover:text-foreground'
    );
  return (
    <div className="flex items-center rounded-md border border-border p-0.5">
      <Tip label="Unified view">
        <button
          type="button"
          onClick={() => setDiffOptions({ view: 'unified' })}
          className={option('unified')}
        >
          <RowsIcon className="size-3.5" /> Unified
        </button>
      </Tip>
      <Tip label="Side-by-side view">
        <button
          type="button"
          onClick={() => setDiffOptions({ view: 'split' })}
          className={option('split')}
        >
          <ColumnsIcon className="size-3.5" /> Split
        </button>
      </Tip>
    </div>
  );
}

function CommentStepper({
  count,
  index,
  onPrev,
  onNext,
}: {
  count: number;
  index: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-0.5 text-xs text-muted-foreground">
      <MessageSquareIcon className="size-3.5" />
      <span className="tabular-nums">
        {index >= 0 ? index + 1 : '–'}/{count}
      </span>
      <Tip label="Previous comment">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onPrev}
          aria-label="Previous comment"
        >
          <ChevronUpIcon />
        </Button>
      </Tip>
      <Tip label="Next comment">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNext}
          aria-label="Next comment"
        >
          <ChevronDownIcon />
        </Button>
      </Tip>
    </div>
  );
}
