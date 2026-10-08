import type { VirtualItem } from '@tanstack/react-virtual';
import type { DiffLine } from '@n10/diff';
import type { FlatRow } from '../../../lib/diff/diff-virtual.js';
import { rowGutter } from './code-gutter.js';
import { DiffRowView, type RowContext } from './DiffRowView.js';

/** The mounted slice of the virtual diff, positioned in its full-height list. */
export function DiffVisibleRows({
  rows,
  items,
  linesByFile,
  ctx,
  height,
  measureElement,
}: {
  rows: FlatRow[];
  items: VirtualItem[];
  linesByFile: ReadonlyMap<string, DiffLine[]>;
  ctx: RowContext;
  height: number;
  measureElement: (element: Element | null) => void;
}) {
  return (
    <div className="relative font-mono text-sm leading-5" style={{ height }}>
      {items.map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          // Benchmarks distinguish code rows from headers and comments.
          data-row-kind={rows[item.index].kind}
          ref={measureElement}
          className="absolute top-0 left-0 w-full"
          style={{
            transform: `translateY(${item.start}px)`,
            ...rowGutter(rows[item.index], linesByFile),
          }}
        >
          <DiffRowView row={rows[item.index]} ctx={ctx} />
        </div>
      ))}
    </div>
  );
}
