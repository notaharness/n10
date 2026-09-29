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
import { focusIsLost } from '../../../lib/focus.js';
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
    linesByFile,
    split: options.view === 'split',
  });
  const { mineByFile, mineCount } = comments;

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
        mineCount,
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
      mineCount,
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

  // Moving through lines, or back from a closed composer, may land on
  // a row the list has not mounted: scroll it into view, then focus it
  // once it renders, which can take the virtualizer a few frames.
  const { nav } = comments;
  useEffect(() => {
    const focusIn = (
      selector: string,
      index: number | undefined,
      // A closing control hands the keyboard on only once it has gone;
      // never take it from where the reader is (a toast's Undo gives it
      // back itself).
      onlyIfLost = false
    ) => {
      const find = () =>
        scrollRef.current?.querySelector<HTMLElement>(selector);
      const free = () => !onlyIfLost || focusIsLost();
      const here = find();
      // A neighbour is almost always mounted: focus it now, so the
      // next key press already starts from it.
      if (here && free()) {
        here.focus();
        here.scrollIntoView({ block: 'nearest' });
        return;
      }
      // Otherwise wait a frame: a card replacing its composer renders
      // in place. Only a target still missing then is scrolled to.
      const retry = (left: number) => {
        const el = find();
        if (el && free()) {
          el.focus({ preventScroll: true });
          el.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (!el && left === 10 && index != null) {
          virtualizer.scrollToIndex(index, { align: 'auto' });
        }
        if (left > 0) requestAnimationFrame(() => retry(left - 1));
      };
      requestAnimationFrame(() => retry(10));
    };
    const file = (f: string) => `[data-file="${CSS.escape(f)}"]`;
    nav.current = {
      pointsOf: (f) => points.byFile.get(f) ?? [],
      rowOf: (p) => points.rowOf.get(pointKey(p)),
      focus: (p, onlyIfLost) =>
        focusIn(
          `${file(p.file)}[data-point="${pointId(p)}"]`,
          points.rowOf.get(pointKey(p)),
          onlyIfLost
        ),
      focusFileComment: (f) =>
        focusIn(
          `[data-file-comment="${CSS.escape(f)}"]`,
          flat.fileIndex.get(f),
          true
        ),
      focusDraft: (key) =>
        focusIn(
          `[data-my-draft="${CSS.escape(key)}"]`,
          flat.indexById.get(key),
          true
        ),
    };
  });

  // In Split the new side is where most comments go, so a file's tab
  // stop is its first new-side line; Left and Right cross columns.
  const split = options.view === 'split';
  const firstPoint = (f: string) => {
    const all = points.byFile.get(f);
    return (split && all?.find((p) => p.side === 'RIGHT')) || all?.[0] || null;
  };

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
    firstPoint,
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
      <div role="status" aria-live="polite" className="sr-only">
        {comments.announcement}
      </div>
    </MyDraftsContext.Provider>
  );
}
