import type { DiffLine } from '@n10/diff';
import type { RemoteCommentThread } from '../../../../host/contract.js';
import type { FileStats, FlatRow } from '../../../lib/diff/diff-virtual.js';
import {
  cellHighlight,
  lineHighlight,
  type FileAnalysis,
} from '../../../lib/diff/highlight.js';
import {
  splitPoint,
  unifiedPoint,
  type LinePoint,
} from '../../../lib/diff/range-selection.js';
import { CommentBlock, OrphanBlock } from '../comments/CommentBlock.js';
import { ConversationPanel } from '../comments/ConversationPanel.js';
import { MyDraftCard } from '../comments/MyDraftCard.js';
import { DiffFileHeader } from './DiffFileHeader.js';
import { FoldRow, HunkRow, SplitCell, UnifiedRow } from './diff-rows.js';
import type { GutterProps } from './LineGutter.js';

/** Everything a row of the virtual diff draws from. */
export interface RowContext {
  linesByFile: ReadonlyMap<string, DiffLine[]>;
  analyses: ReadonlyMap<string, FileAnalysis>;
  stats: ReadonlyMap<string, FileStats>;
  wrap: boolean;
  prId: number;
  headSha: string | undefined;
  focusThreadId: string | null;
  generalThreads: RemoteCommentThread[];
  commentsLoading: boolean;
  patchFile: (
    file: string,
    patch: { open?: boolean; viewed?: boolean }
  ) => void;
  expand: (
    file: string,
    fold: { from: number; to: number },
    dir: 'up' | 'down' | 'all'
  ) => void;
  /** Null when the diff cannot take comments (no pull request). */
  gutterFor:
    | ((point: LinePoint, first: LinePoint | null) => GutterProps)
    | null;
  firstPoint: (file: string) => LinePoint | null;
  commentOnFile: ((file: string) => void) | null;
}

function gutter(
  ctx: RowContext,
  point: LinePoint | null
): GutterProps | undefined {
  if (!point || !ctx.gutterFor) return undefined;
  return ctx.gutterFor(point, ctx.firstPoint(point.file));
}

function FileHeaderRow({
  row,
  ctx,
}: {
  row: { file: string };
  ctx: RowContext;
}) {
  const s = ctx.stats.get(row.file);
  if (!s) return null;
  const { commentOnFile } = ctx;
  return (
    <div data-file={row.file} className="border-t border-border">
      <DiffFileHeader
        filename={row.file}
        open={s.open}
        onToggleOpen={() => ctx.patchFile(row.file, { open: !s.open })}
        viewed={s.viewed}
        onToggleViewed={() =>
          ctx.patchFile(row.file, { viewed: !s.viewed, open: s.viewed })
        }
        onCommentFile={
          commentOnFile ? () => commentOnFile(row.file) : undefined
        }
        collapseReason={s.collapseReason}
        draftCount={s.draftCount}
        mineCount={s.mineCount}
        openThreads={s.openThreads}
        adds={s.adds}
        dels={s.dels}
      />
    </div>
  );
}

function CodeRow({
  row,
  ctx,
}: {
  row: Extract<FlatRow, { kind: 'unified' | 'split-context' | 'split-pair' }>;
  ctx: RowContext;
}) {
  const analysis = ctx.analyses.get(row.file);
  if (row.kind === 'unified') {
    const line = ctx.linesByFile.get(row.file)![row.index];
    const hl = lineHighlight(analysis, row.index);
    return (
      <UnifiedRow
        line={line}
        tokens={hl.tokens}
        ranges={hl.ranges}
        wrap={ctx.wrap}
        gutter={gutter(ctx, unifiedPoint(row.file, line))}
      />
    );
  }
  if (row.kind === 'split-context') {
    const line = ctx.linesByFile.get(row.file)![row.index];
    const { tokens } = lineHighlight(analysis, row.index);
    const cell = { index: row.index, line };
    return (
      <div className="grid grid-cols-2">
        <SplitCell
          cell={cell}
          tokens={tokens}
          side="L"
          wrap
          gutter={gutter(ctx, splitPoint(row.file, line, 'L'))}
        />
        <SplitCell
          cell={cell}
          tokens={tokens}
          side="R"
          wrap
          gutter={gutter(ctx, splitPoint(row.file, line, 'R'))}
        />
      </div>
    );
  }
  const { left, right } = row.row;
  const hlLeft = cellHighlight(analysis, left);
  const hlRight = cellHighlight(analysis, right);
  return (
    <div className="grid grid-cols-2">
      <SplitCell
        cell={left}
        tokens={hlLeft.tokens}
        ranges={hlLeft.ranges}
        side="L"
        wrap
        gutter={gutter(ctx, left && splitPoint(row.file, left.line, 'L'))}
      />
      <SplitCell
        cell={right}
        tokens={hlRight.tokens}
        ranges={hlRight.ranges}
        side="R"
        wrap
        gutter={gutter(ctx, right && splitPoint(row.file, right.line, 'R'))}
      />
    </div>
  );
}

/** One row of the virtual diff, drawn with the shared row primitives. */
export function DiffRowView({ row, ctx }: { row: FlatRow; ctx: RowContext }) {
  switch (row.kind) {
    case 'conversation':
      return (
        <ConversationPanel
          threads={ctx.generalThreads}
          loading={ctx.commentsLoading}
          prId={ctx.prId}
          focusThreadId={ctx.focusThreadId}
        />
      );
    case 'file-header':
      return <FileHeaderRow row={row} ctx={ctx} />;
    case 'file-drafts':
      return (
        <div className="space-y-2 border-b border-border bg-muted/30 px-4 py-2">
          {row.mine.map((m) => (
            <MyDraftCard key={m.key} target={m} />
          ))}
        </div>
      );
    case 'hunk':
      return <HunkRow line={ctx.linesByFile.get(row.file)![row.index]} />;
    case 'fold':
      return (
        <FoldRow
          fold={{ from: row.from, to: row.to }}
          onExpand={(fold, dir) => ctx.expand(row.file, fold, dir)}
        />
      );
    case 'unified':
    case 'split-context':
    case 'split-pair':
      return <CodeRow row={row} ctx={ctx} />;
    case 'comments':
      return (
        <CommentBlock
          threads={row.threads}
          drafts={row.drafts}
          mine={row.mine}
          prId={ctx.prId}
          headSha={ctx.headSha}
          focusId={ctx.focusThreadId}
          indent={row.indent}
        />
      );
    case 'orphans':
      return (
        <OrphanBlock
          threads={row.threads}
          drafts={row.drafts}
          mine={row.mine}
          prId={ctx.prId}
          headSha={ctx.headSha}
          focusId={ctx.focusThreadId}
        />
      );
  }
}
