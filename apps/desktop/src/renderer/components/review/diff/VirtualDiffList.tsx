import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from 'react';
import type { DiffLine } from '@n10/diff';
import type {
  PrDiffManifestFile,
  RemoteCommentThread,
  ReviewComment,
} from '../../../../host/contract.js';
import { expandIndices } from '../../../lib/diff/diff-model.js';
import { useDiffOptions } from '../../../lib/diff/diff-options.js';
import { useReportVisibleDiffFiles } from '../../../lib/diff/visible-files-context.js';
import { filesOnScreen } from '../../../lib/diff/diff-rows-model.js';
import { linePoints, pointKey } from '../../../lib/diff/diff-points.js';
import {
  buildFlatDiff,
  estimateRowHeight,
  type FileDisplayState,
} from '../../../lib/diff/diff-virtual.js';
import { useFileAnalyses } from '../../../lib/diff/highlight.js';
import { MyDraftsContext } from '../../../lib/review/my-drafts-context.js';
import {
  readsSettled,
  scrollTelling,
  useDiffJumps,
  type DiffJumpHandle,
} from '../../../lib/diff/use-diff-jumps.js';
import type { PrDiffView } from '../../../lib/review/use-pr-diff.js';
import { useTheme } from '../../../lib/theme.js';
import type { RowContext } from './DiffRowView.js';
import { DiffVisibleRows } from './DiffVisibleRows.js';
import { pointId } from './LineGutter.js';
import { useDiffAnchor } from './use-diff-anchor.js';
import { useDiffComments } from './use-diff-comments.js';
import type { TextMatch } from '../../../lib/diff/text-matches.js';
import { useDiffSearchTarget } from './use-diff-search-target.js';
import { focusDiffRow } from './diff-focus.js';

const NO_MANIFEST: ReadonlyMap<string, PrDiffManifestFile> = new Map();

export type { DiffJumpHandle };

/**
 * The all-files diff as ONE virtualized list: only the rows in (and
 * around) the viewport exist as DOM, terminal-style, so a whole-file
 * diff of any size mounts and scrolls at a constant cost. Row visuals
 * are the same primitives the per-file view used.
 */
export function VirtualDiffList({
  files,
  searchFiles,
  diffHead,
  threadsByFile,
  draftsByFile,
  generalThreads,
  commentsLoading,
  prId,
  headSha,
  focusThreadId,
  scrollRef,
  jumpRef,
  prDiff,
  searchTerm,
  selectionTerm,
  searchTarget,
  searchRequest,
}: {
  files: [string, DiffLine[]][];
  /** The complete comparison, including files outside single-file mode. */
  searchFiles: [string, DiffLine[]][];
  /** The commit the diff was read at; what new comments anchor to. */
  diffHead: string | null;
  threadsByFile: Map<string, RemoteCommentThread[]>;
  draftsByFile: Map<string, ReviewComment[]>;
  generalThreads: RemoteCommentThread[];
  commentsLoading: boolean;
  prId: number;
  headSha?: string;
  focusThreadId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  jumpRef?: Ref<DiffJumpHandle>;
  /** A pull request's manifest and file bodies; absent for a worktree,
   *  whose files all arrive with their lines. */
  prDiff?: PrDiffView;
  searchTerm: string;
  selectionTerm: string;
  searchTarget: TextMatch | null;
  searchRequest: number;
}) {
  const options = useDiffOptions();
  const { resolved } = useTheme();
  const [fileState, setFileState] = useState<Map<string, FileDisplayState>>(
    () => new Map()
  );

  const linesByFile = useMemo(() => new Map(files), [files]);
  const manifest = prDiff?.manifestByPath ?? NO_MANIFEST;
  const comments = useDiffComments({
    prId,
    head: diffHead,
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
        ...(prDiff
          ? {
              bodies: prDiff.bodies,
              counts: prDiff.counts,
              anchored: prDiff.anchored,
            }
          : {}),
      }),
    [
      prDiff,
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
    () => linePoints(rows, linesByFile, prDiff?.anchored),
    [rows, linesByFile, prDiff?.anchored]
  );

  // Scrolls the list makes itself reach the jumps as they happen.
  const scrolledRef = useRef<(() => void) | null>(null);
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
    scrollToFn: scrollTelling(scrolledRef),
  });
  const virtualItems = virtualizer.getVirtualItems();
  useReportVisibleDiffFiles(rows, virtualizer);
  useDiffAnchor({
    ready: files.length > 0,
    points,
    virtualizer,
    scrollRef,
  });

  // Highlight only files that currently have rows on screen.
  const { shown: wantedFiles, toRead } = useMemo(
    () =>
      filesOnScreen(
        rows,
        virtualItems.map((vi) => vi.index)
      ),
    // virtualItems identity churns per scroll frame; the derived sets
    // are tiny and memo keeps downstream effects keyed on real changes.
    [virtualItems, rows]
  );
  const analyses = useFileAnalyses(linesByFile, resolved, wantedFiles);

  // An open file on screen is a file to read: its batch is asked for
  // once the list settles with its placeholder in view. Not while it
  // scrolls: a drag through the list would ask for every batch it
  // passes.
  const showFiles = prDiff?.showFiles;
  const scrolling = virtualizer.isScrolling;
  useEffect(() => {
    if (!scrolling)
      showFiles?.(searchTerm ? searchFiles.map(([path]) => path) : toRead);
  }, [showFiles, toRead, scrolling, searchTerm, searchFiles]);

  const scrollToSearch = useCallback(
    (index: number) => virtualizer.scrollToIndex(index, { align: 'center' }),
    [virtualizer]
  );
  useDiffSearchTarget(
    searchTarget,
    searchRequest,
    rows,
    linesByFile,
    setFileState,
    scrollToSearch,
    scrollRef
  );

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

  useDiffJumps(
    jumpRef,
    flat,
    points.rowOf,
    rows,
    virtualizer,
    scrollRef,
    scrolledRef,
    readsSettled(prDiff, toRead)
  );

  // Moving through lines, or back from a closed composer, may land on
  // a row the list has not mounted: scroll it into view, then focus it
  // once it renders, which can take the virtualizer a few frames.
  useEffect(() => {
    const focusIn = (
      selector: string,
      index: number | undefined,
      onlyIfLost = false
    ) =>
      focusDiffRow(
        scrollRef,
        (i) => virtualizer.scrollToIndex(i, { align: 'auto' }),
        selector,
        index,
        onlyIfLost
      );
    const file = (f: string) => `[data-file="${CSS.escape(f)}"]`;
    comments.nav.current = {
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

  // Each mounted file header's toggle, where a file notice that
  // replaces itself hands the keyboard.
  const headers = useRef(new Map<string, HTMLButtonElement>());

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
    searchTerm,
    searchTarget,
    selectionTerm,
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
    manifest,
    prDiff,
    headers: headers.current,
    commentable: (p) => points.rowOf.has(pointKey(p)),
  };

  return (
    <MyDraftsContext.Provider value={comments.scope}>
      <DiffVisibleRows
        rows={rows}
        items={virtualItems}
        linesByFile={linesByFile}
        ctx={ctx}
        height={virtualizer.getTotalSize()}
        measureElement={virtualizer.measureElement}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {comments.announcement}
      </div>
    </MyDraftsContext.Provider>
  );
}
