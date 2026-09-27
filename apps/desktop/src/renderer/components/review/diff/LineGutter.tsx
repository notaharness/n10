import { MessageSquarePlusIcon } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import {
  rangeWords,
  type LinePoint,
} from '../../../lib/diff/range-selection.js';
import { cn } from '../../../lib/utils.js';

/**
 * How a line's gutter takes part in commenting. The line number is a
 * button: click to select it, Shift-click to extend the selection on
 * the same side. With it focused, Up/Down move and Shift+Up/Down
 * extend; Enter opens a comment on the selection. One gutter per file
 * is a tab stop, so reading the diff never means tabbing through
 * every line. The code itself stays plain text to select and copy.
 */
export interface GutterProps {
  point: LinePoint;
  selected: boolean;
  tabbable: boolean;
  /** This line ends the selection: it carries the comment button. */
  commentHere: boolean;
  /** Words for the selected range, for the comment button's name. */
  rangeLabel: string | null;
  onPoint: (point: LinePoint, extend: boolean) => void;
  onKey: (e: KeyboardEvent, point: LinePoint) => void;
  onComment: () => void;
}

export function pointId(p: LinePoint): string {
  return `${p.side}:${p.line}`;
}

export function LineGutter({
  gutter,
  className,
  children,
}: {
  gutter: GutterProps;
  className?: string;
  children: ReactNode;
}) {
  const { point, selected } = gutter;
  const words = rangeWords({
    startSide: point.side,
    start: point.line,
    side: point.side,
    end: point.line,
  });
  return (
    <span className={cn('relative flex', className)}>
      <button
        type="button"
        data-point={pointId(point)}
        data-file={point.file}
        tabIndex={gutter.tabbable ? 0 : -1}
        aria-pressed={selected}
        aria-label={`Select ${words}`}
        onClick={(e) => gutter.onPoint(point, e.shiftKey)}
        onKeyDown={(e) => gutter.onKey(e, point)}
        className={cn(
          'flex cursor-pointer outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          selected && 'bg-primary/25 text-foreground'
        )}
      >
        {children}
      </button>
      {gutter.commentHere && (
        <button
          type="button"
          aria-label={`Comment on ${gutter.rangeLabel ?? words}`}
          title={`Comment on ${gutter.rangeLabel ?? words}`}
          onClick={gutter.onComment}
          className="absolute -right-5 top-0 z-[2] flex size-5 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <MessageSquarePlusIcon className="size-3.5" />
        </button>
      )}
    </span>
  );
}
