import {
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { DiffLine } from '@n10/diff';
import type { SplitCell } from '../../../lib/diff/diff-model.js';
import type { CharRange } from '../../../lib/diff/word-diff.js';
import type { LineTokens } from '../../../lib/diff/highlight.js';
import { textRanges } from '../../../lib/diff/text-matches.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';
import { LineGutter, type GutterProps } from './LineGutter.js';
import { shiftRanges, splitRanges } from './diff-text-segments.js';

export const ROW_BG: Record<DiffLine['type'], string> = {
  add: 'bg-diff-add',
  remove: 'bg-diff-del',
  context: '',
  'hunk-header': '',
};
export const GUTTER_BG: Record<DiffLine['type'], string> = {
  add: 'bg-diff-add-gutter',
  remove: 'bg-diff-del-gutter',
  context: 'bg-background',
  'hunk-header': '',
};
export const SIGN: Record<DiffLine['type'], string> = {
  add: '+',
  remove: '−',
  context: ' ',
  'hunk-header': '',
};

/** Sign column, coloured for add/remove. */
export function SignCell({ type }: { type: DiffLine['type'] }) {
  return (
    <span
      className={cn(
        'w-5 text-center',
        type === 'add' && 'text-success',
        type === 'remove' && 'text-destructive'
      )}
    >
      {SIGN[type]}
    </span>
  );
}

/**
 * Highlighted line content with optional word-diff emphasis ranges.
 * Shared by the unified/split diff rows and the walkthrough snippet.
 */
export function LineContent({
  line,
  tokens,
  ranges,
  wrap,
  searchTerm,
  selectionTerm,
  activeSearchStart,
}: {
  line: DiffLine;
  tokens: LineTokens | undefined;
  ranges?: CharRange[];
  wrap?: boolean;
  searchTerm?: string;
  selectionTerm?: string;
  activeSearchStart?: number;
}) {
  const text = line.content || ' ';
  const searchRanges = textRanges(text, searchTerm ?? '');
  const selectionRanges = textRanges(text, selectionTerm ?? '');
  const emphasis =
    line.type === 'add'
      ? 'bg-success/25 rounded-[2px]'
      : line.type === 'remove'
      ? 'bg-destructive/25 rounded-[2px]'
      : '';
  const cls = cn(
    'min-w-0 pr-6',
    wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
  );

  if (!tokens) {
    return (
      <span data-diff-code className={cls}>
        {splitRanges(
          text,
          ranges,
          emphasis,
          '',
          searchRanges,
          selectionRanges,
          activeSearchStart
        )}
      </span>
    );
  }
  let pos = 0;
  const out: ReactNode[] = [];
  tokens.forEach((tok, j) => {
    const start = pos;
    const end = pos + tok.content.length;
    pos = end;
    out.push(
      <span key={start} style={{ color: tok.color }}>
        {splitRanges(
          tok.content,
          shiftRanges(ranges, start, end),
          emphasis,
          j,
          shiftRanges(searchRanges, start, end) ?? [],
          shiftRanges(selectionRanges, start, end) ?? [],
          activeSearchStart !== undefined &&
            activeSearchStart >= start &&
            activeSearchStart < end
            ? activeSearchStart - start
            : undefined
        )}
      </span>
    );
  });
  return (
    <span data-diff-code className={cls}>
      {out}
    </span>
  );
}

/** One unified-diff line: old/new gutter + sign + content. */
export function UnifiedRow({
  line,
  tokens,
  ranges,
  wrap,
  gutter,
  searchTerm,
  selectionTerm,
  activeSearchStart,
}: {
  line: DiffLine;
  tokens: LineTokens | undefined;
  ranges?: CharRange[];
  wrap: boolean;
  gutter?: GutterProps;
  searchTerm?: string;
  selectionTerm?: string;
  activeSearchStart?: number;
}) {
  const numbers = (
    <>
      <span className="w-[var(--gutter,2.75rem)] pr-2 text-right tabular-nums">
        {line.oldLine ?? ''}
      </span>
      <span className="w-[var(--gutter,2.75rem)] pr-2 text-right tabular-nums">
        {line.newLine ?? ''}
      </span>
    </>
  );
  return (
    <div
      className={cn('flex', wrap ? 'w-full' : 'min-w-max', ROW_BG[line.type])}
    >
      <span
        className={cn(
          'sticky left-0 z-[1] flex shrink-0 select-none text-muted-foreground/70',
          GUTTER_BG[line.type]
        )}
      >
        {gutter ? <LineGutter gutter={gutter}>{numbers}</LineGutter> : numbers}
        <SignCell type={line.type} />
      </span>
      <LineContent
        line={line}
        tokens={tokens}
        ranges={ranges}
        wrap={wrap}
        searchTerm={searchTerm}
        selectionTerm={selectionTerm}
        activeSearchStart={activeSearchStart}
      />
    </div>
  );
}

/** One side of a split-diff row (or an empty filler cell). */
export function SplitCell({
  cell,
  tokens,
  ranges,
  side,
  wrap,
  gutter,
  searchTerm,
  selectionTerm,
  activeSearchStart,
}: {
  cell: SplitCell | null;
  tokens: LineTokens | undefined;
  ranges?: CharRange[];
  side: 'L' | 'R';
  wrap: boolean;
  gutter?: GutterProps;
  searchTerm?: string;
  selectionTerm?: string;
  activeSearchStart?: number;
}) {
  if (!cell) {
    return <div className="min-w-0 border-l border-border bg-muted/20" />;
  }
  const { line } = cell;
  const num = side === 'L' ? line.oldLine : line.newLine;
  return (
    <div
      className={cn(
        'flex min-w-0',
        side === 'R' && 'border-l border-border',
        ROW_BG[line.type]
      )}
    >
      <span
        className={cn(
          'flex shrink-0 select-none text-muted-foreground/70',
          GUTTER_BG[line.type]
        )}
      >
        {gutter ? (
          <LineGutter gutter={gutter}>
            <span className="w-[var(--gutter,2.75rem)] pr-2 text-right tabular-nums">
              {num ?? ''}
            </span>
          </LineGutter>
        ) : (
          <span className="w-[var(--gutter,2.75rem)] pr-2 text-right tabular-nums">
            {num ?? ''}
          </span>
        )}
        <SignCell type={line.type} />
      </span>
      <LineContent
        line={line}
        tokens={tokens}
        ranges={ranges}
        wrap={wrap}
        searchTerm={searchTerm}
        selectionTerm={selectionTerm}
        activeSearchStart={activeSearchStart}
      />
    </div>
  );
}

/** Collapsed run of unchanged lines with expand controls. */
export function FoldRow({
  fold,
  onExpand,
}: {
  fold: { from: number; to: number };
  onExpand: (
    fold: { from: number; to: number },
    dir: 'up' | 'down' | 'all'
  ) => void;
}) {
  const count = fold.to - fold.from;
  return (
    <div className="flex h-7 items-center gap-1 border-y border-border bg-diff-hunk/60 px-2 font-sans text-xs text-muted-foreground">
      <Tip label="Show 20 more lines above">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onExpand(fold, 'up')}
          aria-label="Expand up"
        >
          <ChevronUpIcon />
        </Button>
      </Tip>
      <Tip label="Show 20 more lines below">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onExpand(fold, 'down')}
          aria-label="Expand down"
        >
          <ChevronDownIcon />
        </Button>
      </Tip>
      <button
        type="button"
        onClick={() => onExpand(fold, 'all')}
        className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
      >
        <ChevronsUpDownIcon className="size-3.5" />
        {count} unchanged line{count === 1 ? '' : 's'} hidden
      </button>
    </div>
  );
}

/** A @@ hunk header row. */
export function HunkRow({ line }: { line: DiffLine }) {
  return (
    <div className="flex h-6 items-center bg-diff-hunk px-3 text-xs text-diff-hunk-fg">
      <span className="truncate">{line.content}</span>
    </div>
  );
}
