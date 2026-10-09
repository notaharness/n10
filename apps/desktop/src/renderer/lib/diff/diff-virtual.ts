import type { DiffLine } from '@n10/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import type { InlineTarget } from '../review/my-drafts.js';
import {
  anchorKey,
  buildSplitRows,
  buildUnifiedRows,
  defaultCollapseReason,
  type SplitRow,
} from './diff-model.js';
import {
  anchorComments,
  presentAnchors,
  pushOrphans,
  splitMine,
} from './diff-anchors.js';
import {
  noticeRow,
  type FileDisplayState,
  type FileStats,
  type FlatDiff,
  type FlatDiffOptions,
  type FlatRow,
} from './diff-rows-model.js';
import type { FileBody } from './diff-bodies.js';

export {
  estimateRowHeight,
  type FileDisplayState,
  type FileStats,
  type FlatDiff,
  type FlatDiffOptions,
  type FlatRow,
} from './diff-rows-model.js';

const BOTH_SIDES = { LEFT: true, RIGHT: true } as const;

/** A file's comments by the line each sits under, on the sides `on`
 *  numbers as comments do: threads, the agent's drafts, and the
 *  reviewer's own. */
function anchorFile(
  lines: readonly DiffLine[],
  threads: readonly RemoteCommentThread[],
  drafts: readonly ReviewComment[],
  mine: ReturnType<typeof splitMine>['onLines'],
  on: NonNullable<FlatDiffOptions['anchored']> = BOTH_SIDES
) {
  const present = presentAnchors(lines);
  const t = anchorComments(present, threads, (x) =>
    x.lineStart == null || !on[x.side] ? null : x.lineEnd ?? x.lineStart
  );
  const d = anchorComments(present, drafts, (x) =>
    on[x.side] ? x.lineEnd : null
  );
  const m = anchorComments(present, mine, (x) =>
    on[x.side] ? x.anchor.range!.end : null
  );
  return {
    t,
    d,
    m,
    pinnedAll: new Set([...t.pinned, ...d.pinned, ...m.pinned]),
  };
}

/**
 * A file's changed lines: Git's counts from the manifest, else the lines
 * in hand — but only once they are the file's lines. A pull request's
 * file not read yet has none, and zero would say nothing changed.
 */
function lineCounts(
  file: string,
  lines: readonly DiffLine[],
  opts: FlatDiffOptions
): { adds: number | null; dels: number | null } {
  const counted = opts.counts?.get(file);
  if (counted) return { adds: counted.additions, dels: counted.deletions };
  if (opts.bodies && opts.bodies.get(file)?.state !== 'loaded') {
    return { adds: null, dels: null };
  }
  return {
    adds: lines.filter((l) => l.type === 'add').length,
    dels: lines.filter((l) => l.type === 'remove').length,
  };
}

/**
 * Everything one file contributes before its rows are laid out: the
 * header stats, and the comment sets those rows will hang off.
 *
 * `openThreads` counts unresolved threads whether or not they are
 * currently shown — the header says how much is outstanding, and
 * hiding resolved comments must not change that number.
 */
function fileSlice(
  file: string,
  lines: DiffLine[],
  opts: FlatDiffOptions
): {
  state: FileDisplayState;
  stats: FileStats;
  visibleThreads: RemoteCommentThread[];
  activeDrafts: ReviewComment[];
} {
  const state = opts.fileState.get(file) ?? {};
  const { adds, dels } = lineCounts(file, lines, opts);
  const collapseReason = defaultCollapseReason(file, (adds ?? 0) + (dels ?? 0));
  const allThreads = opts.threadsByFile.get(file) ?? [];
  const visibleThreads = opts.hideResolved
    ? allThreads.filter((t) => !t.isResolved)
    : allThreads;
  const activeDrafts = (opts.draftsByFile.get(file) ?? []).filter(
    (d) => d.status !== 'posted'
  );
  return {
    state,
    stats: {
      adds,
      dels,
      openThreads: allThreads.filter((t) => !t.isResolved).length,
      draftCount: activeDrafts.length,
      mineCount: opts.mineCount?.get(file) ?? 0,
      collapseReason,
      open: state.open ?? collapseReason === null,
      viewed: state.viewed ?? false,
    },
    visibleThreads,
    activeDrafts,
  };
}

/**
 * A file with no lines on screen: a notice in their place. Lines on the
 * way (`loading`) take its comments with them — a jump to one lands on
 * the file now and follows the comment in when they arrive, rather than
 * the comment showing here and then moving. A file with no lines to
 * anchor to, or none unless asked, keeps its comments under the notice.
 */
function pushUnread(
  rows: FlatRow[],
  indexById: Map<string, number>,
  file: string,
  body: FileBody,
  slice: ReturnType<typeof fileSlice>,
  mine: InlineTarget[]
): void {
  const notice = rows.length;
  rows.push(noticeRow(file, slice.stats, body));
  const { visibleThreads, activeDrafts } = slice;
  if (body.state !== 'loading') {
    pushOrphans(rows, indexById, file, visibleThreads, activeDrafts, mine);
    return;
  }
  for (const x of [...visibleThreads, ...activeDrafts]) {
    indexById.set(x.id, notice);
  }
  for (const x of mine) indexById.set(x.key, notice);
}

/** The reviewer's comments on a whole file, under its header, so they
 *  show even while the file is collapsed (generated, large, or marked
 *  Viewed). */
function pushFileDrafts(
  rows: FlatRow[],
  indexById: Map<string, number>,
  file: string,
  mine: InlineTarget[]
): void {
  if (mine.length === 0) return;
  for (const x of mine) indexById.set(x.key, rows.length);
  rows.push({ key: `fd:${file}`, kind: 'file-drafts', file, mine });
}

/**
 * What a pull request's file body adds before its lines: a notice in
 * place of lines not in hand, or one introducing lines read by their
 * changes alone. True when there are no lines to lay out.
 */
function pushBodyRows(
  rows: FlatRow[],
  indexById: Map<string, number>,
  file: string,
  opts: FlatDiffOptions,
  slice: ReturnType<typeof fileSlice>,
  mine: InlineTarget[]
): boolean {
  const body = opts.bodies?.get(file);
  if (body && body.state !== 'loaded') {
    pushUnread(rows, indexById, file, body, slice, mine);
    return true;
  }
  if (body?.scope === 'changes') rows.push(noticeRow(file, slice.stats));
  return false;
}

export function buildFlatDiff(
  files: readonly [string, DiffLine[]][],
  opts: FlatDiffOptions
): FlatDiff {
  const rows: FlatRow[] = [];
  const indexById = new Map<string, number>();
  const fileIndex = new Map<string, number>();
  const stats = new Map<string, FileStats>();

  if (opts.hasConversation) {
    rows.push({ key: 'conversation', kind: 'conversation' });
    for (const t of opts.generalThreads) indexById.set(t.id, 0);
  }

  for (const [file, lines] of files) {
    const slice = fileSlice(file, lines, opts);
    const { state, visibleThreads, activeDrafts } = slice;

    fileIndex.set(file, rows.length);
    rows.push({ key: `h:${file}`, kind: 'file-header', file });
    stats.set(file, slice.stats);
    const own = splitMine(opts.mineByFile?.get(file) ?? []);
    pushFileDrafts(rows, indexById, file, own.onFile);
    if (!slice.stats.open) continue;
    if (pushBodyRows(rows, indexById, file, opts, slice, own.onLines)) {
      continue;
    }

    const { t, d, m, pinnedAll } = anchorFile(
      lines,
      visibleThreads,
      activeDrafts,
      own.onLines,
      opts.anchored
    );

    const unified = buildUnifiedRows(lines, {
      pinnedAnchors: pinnedAll,
      expanded: state.expanded ?? new Set(),
      noFold: lines.length <= 40,
    });

    const pushComments = (
      line: DiffLine,
      keySuffix: string,
      onlyLeft: boolean,
      indent: boolean
    ) => {
      const threads: RemoteCommentThread[] = [];
      const drafts: ReviewComment[] = [];
      const mine: InlineTarget[] = [];
      const take = (anchor: string) => {
        threads.push(...(t.byAnchor.get(anchor) ?? []));
        drafts.push(...(d.byAnchor.get(anchor) ?? []));
        mine.push(...(m.byAnchor.get(anchor) ?? []));
      };
      if (!onlyLeft && line.newLine != null) take(anchorKey('R', line.newLine));
      // A context line carries both an old and a new number, and a
      // LEFT-side comment anchors to the old one. Taking the L anchor
      // only for removed lines dropped those comments entirely: they
      // count as anchored (so they never reach the orphan tail) but no
      // row ever emitted them. Whole-file diffs make most lines
      // context lines, and GitHub marks real threads LEFT.
      if ((onlyLeft || line.type !== 'add') && line.oldLine != null) {
        take(anchorKey('L', line.oldLine));
      }
      if (threads.length + drafts.length + mine.length === 0) return;
      const index = rows.length;
      rows.push({
        key: `c:${file}:${keySuffix}`,
        kind: 'comments',
        file,
        threads,
        drafts,
        mine,
        indent,
      });
      for (const x of threads) indexById.set(x.id, index);
      for (const x of drafts) indexById.set(x.id, index);
      for (const x of mine) indexById.set(x.key, index);
    };

    /**
     * A side-by-side row and the comment cards hanging off each half.
     * Either side can be absent where the two files differ in length.
     */
    const pushSplitPair = (row: Extract<SplitRow, { kind: 'pair' }>) => {
      rows.push({
        key: `p:${file}:${row.left?.index ?? 'x'}:${row.right?.index ?? 'x'}`,
        kind: 'split-pair',
        file,
        row,
      });
      if (row.left) {
        pushComments(row.left.line, `l${row.left.index}`, true, false);
      }
      if (row.right) {
        pushComments(row.right.line, `r${row.right.index}`, false, false);
      }
    };

    const pushFold = (from: number, to: number) => {
      rows.push({ key: `f:${file}:${from}`, kind: 'fold', file, from, to });
    };
    const pushHunk = (index: number) => {
      rows.push({ key: `k:${file}:${index}`, kind: 'hunk', file, index });
    };

    /** Side-by-side: every row pairs a left and a right half. */
    const appendSplitRows = () => {
      for (const row of buildSplitRows(lines, unified)) {
        if (row.kind === 'fold') {
          pushFold(row.from, row.to);
        } else if (row.kind === 'hunk') {
          pushHunk(row.index);
        } else if (row.kind === 'context') {
          rows.push({
            key: `s:${file}:${row.index}`,
            kind: 'split-context',
            file,
            index: row.index,
          });
          pushComments(lines[row.index], `s${row.index}`, false, false);
        } else {
          pushSplitPair(row);
        }
      }
    };

    /** One column: each visible line is its own row. */
    const appendUnifiedRows = () => {
      for (const row of unified) {
        if (row.kind === 'fold') {
          pushFold(row.from, row.to);
          continue;
        }
        const line = lines[row.index];
        if (line.type === 'hunk-header') {
          pushHunk(row.index);
          continue;
        }
        rows.push({
          key: `u:${file}:${row.index}`,
          kind: 'unified',
          file,
          index: row.index,
        });
        pushComments(line, `u${row.index}`, false, true);
      }
    };

    if (opts.view === 'split') appendSplitRows();
    else appendUnifiedRows();

    pushOrphans(rows, indexById, file, t.orphans, d.orphans, m.orphans);
  }

  return { rows, indexById, fileIndex, stats };
}
