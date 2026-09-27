import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type Ref,
  type RefObject,
} from 'react';
import type { DiffLine } from '@n10/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../../host/contract.js';
import { expandIndices } from '../../../lib/diff/diff-model.js';
import { useDiffOptions } from '../../../lib/diff/diff-options.js';
import { linePoints, pointKey } from '../../../lib/diff/diff-points.js';
import {
  buildFlatDiff,
  estimateRowHeight,
  type FileDisplayState,
} from '../../../lib/diff/diff-virtual.js';
import { useFileAnalyses } from '../../../lib/diff/highlight.js';
import { MyDraftsContext } from '../../../lib/review/my-drafts-context.js';
import { useTheme } from '../../../lib/theme.js';
import { DiffRowView, type RowContext } from './DiffRowView.js';
import { pointId } from './LineGutter.js';
import { useDiffComments } from './use-diff-comments.js';

/** Imperative scrolling into the virtualized list — jump targets may
 *  not be materialized yet, so DOM queries can't do this. */
export interface DiffJumpHandle {
  /** Scroll the row containing this thread/draft id into view. */
  jumpToId(id: string): boolean;
  /** Scroll a file's header row into view. */
  jumpToFile(file: string): boolean;
}

/**
 * The all-files diff as ONE virtualized list: only the rows in (and
 * around) the viewport exist as DOM, terminal-style, so a whole-file
 * diff of any size mounts and scrolls at a constant cost. Row visuals
 * are the same primitives the per-file view used.
 */
export function VirtualDiffList({
  files,
  threadsByFile,
  draftsByFile,
  generalThreads,
  commentsLoading,
  prId,
  headSha,
  focusThreadId,
  scrollRef,
  jumpRef,
}: {
  files: [string, DiffLine[]][];
  threadsByFile: Map<string, RemoteCommentThread[]>;
  draftsByFile: Map<string, ReviewComment[]>;
  generalThreads: RemoteCommentThread[];
  commentsLoading: boolean;
  prId: number;
  headSha?: string;
  focusThreadId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  jumpRef?: Ref<DiffJumpHandle>;
}) {
  const options = useDiffOptions();
  const { resolved } = useTheme();
  const [fileState, setFileState] = useState<Map<string, FileDisplayState>>(
    () => new Map()
  );

  const linesByFile = useMemo(() => new Map(files), [files]);
  const comments = useDiffComments({
    prId,
    headSha,
    linesByFile,
    split: options.view === 'split',
  });
  const { mineByFile } = comments;

  const flat = useMemo(
    () =>
      buildFlatDiff(files, {
        view: options.view,
        hideResolved: options.hideResolved,
        hasConversation: generalThreads.length > 0 || commentsLoading,
        generalThreads,
        threadsByFile,
        draftsByFile,
        mineByFile,
        fileState,
      }),
    [
      files,
      options.view,
      options.hideResolved,
      generalThreads,
      commentsLoading,
      threadsByFile,
      draftsByFile,
      mineByFile,
      fileState,
    ]
  );
  const rows = flat.rows;
  const points = useMemo(
    () => linePoints(rows, linesByFile),
    [rows, linesByFile]
  );

  // React Compiler declines to memoize a component that calls this,
  // because the virtualizer hands back methods rather than values. That
  // is a property of @tanstack/react-virtual and not something this
  // file can restructure — and the desktop build does not run the
  // compiler, so the notice describes an optimisation that never runs.
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => estimateRowHeight(rows[i]),
    getItemKey: (i) => rows[i].key,
    overscan: 16,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Highlight only files that currently have rows on screen.
  const wantedFiles = useMemo(() => {
    const wanted = new Set<string>();
    for (const vi of virtualItems) {
      const row = rows[vi.index];
      if ('file' in row) wanted.add(row.file);
    }
    return wanted;
    // virtualItems identity churns per scroll frame; the derived set is
    // tiny and memo keeps downstream effects keyed on real changes.
  }, [virtualItems, rows]);
  const analyses = useFileAnalyses(linesByFile, resolved, wantedFiles);

  const patchFile = useCallback(
    (file: string, patch: Partial<FileDisplayState>) =>
      setFileState((prev) => {
        const next = new Map(prev);
        next.set(file, { ...next.get(file), ...patch });
        return next;
      }),
    []
  );
  const expand = useCallback(
    (
      file: string,
      fold: { from: number; to: number },
      dir: 'up' | 'down' | 'all'
    ) =>
      setFileState((prev) => {
        const next = new Map(prev);
        const cur = next.get(file) ?? {};
        const expanded = new Set(cur.expanded ?? []);
        for (const i of expandIndices(fold, dir)) expanded.add(i);
        next.set(file, { ...cur, expanded });
        return next;
      }),
    []
  );

  useImperativeHandle(
    jumpRef,
    () => ({
      jumpToId: (id) => {
        const index = flat.indexById.get(id);
        if (index == null) return false;
        virtualizer.scrollToIndex(index, { align: 'center' });
        return true;
      },
      jumpToFile: (file) => {
        const index = flat.fileIndex.get(file);
        if (index == null) return false;
        virtualizer.scrollToIndex(index, { align: 'start' });
        return true;
      },
    }),
    [flat, virtualizer]
  );

  // Moving through lines may land on one the list has not mounted:
  // scroll it into view, then focus its gutter once it renders.
  const { nav } = comments;
  useEffect(() => {
    nav.current = {
      pointsOf: (file) => points.byFile.get(file) ?? [],
      focus: (point) => {
        const find = () =>
          scrollRef.current?.querySelector<HTMLElement>(
            `[data-file="${CSS.escape(point.file)}"][data-point="${pointId(
              point
            )}"]`
          );
        const here = find();
        // A neighbour is almost always mounted: focus it now, so the
        // next key press already starts from it.
        if (here) {
          here.focus();
          here.scrollIntoView({ block: 'nearest' });
          return;
        }
        const index = points.rowOf.get(pointKey(point));
        if (index == null) return;
        virtualizer.scrollToIndex(index, { align: 'auto' });
        requestAnimationFrame(() => find()?.focus());
      },
    };
  });

  const ctx: RowContext = {
    linesByFile,
    analyses,
    stats: flat.stats,
    wrap: options.wrap,
    prId,
    headSha,
    focusThreadId,
    generalThreads,
    commentsLoading,
    patchFile,
    expand,
    gutterFor: comments.scope.ref ? comments.gutterFor : null,
    firstPoint: (file) => points.byFile.get(file)?.[0] ?? null,
    commentOnFile: comments.scope.ref
      ? (file) => comments.commentOn(file, null)
      : null,
  };

  return (
    <MyDraftsContext.Provider value={comments.scope}>
      <div
        className="relative font-mono text-sm leading-5"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            // Which primitive this row is, for tests and the benchmarks:
            // "is the code coloured yet" has to be asked of code rows,
            // and a class name shared with the sidebar cannot answer it.
            data-row-kind={rows[vi.index].kind}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${vi.start}px)` }}
          >
            <DiffRowView row={rows[vi.index]} ctx={ctx} />
          </div>
        ))}
      </div>
    </MyDraftsContext.Provider>
  );
}
