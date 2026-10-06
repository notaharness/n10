import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import type { InlineTarget } from '../review/my-drafts.js';
import { IMAGE_ROW_HEIGHT, type FileBody } from './diff-bodies.js';
import type { CollapseReason, SplitRow } from './diff-model.js';

// ── Flat rows for the virtualized all-files diff ─────────────────
//
// The diff renders as ONE list across every file — headers, code
// rows, fold markers and comment cards — so the viewer can virtualize
// it (materialize only the rows in the viewport, terminal-style).
// Everything here is pure data: the component maps a FlatRow to the
// existing row primitives.

export type FlatRow =
  | { key: string; kind: 'conversation' }
  | { key: string; kind: 'file-header'; file: string }
  /** The reviewer's own comments on a whole file, under its header. */
  | { key: string; kind: 'file-drafts'; file: string; mine: InlineTarget[] }
  | { key: string; kind: 'hunk'; file: string; index: number }
  | { key: string; kind: 'unified'; file: string; index: number }
  | { key: string; kind: 'split-context'; file: string; index: number }
  | {
      key: string;
      kind: 'split-pair';
      file: string;
      row: Extract<SplitRow, { kind: 'pair' }>;
    }
  | { key: string; kind: 'fold'; file: string; from: number; to: number }
  /** What stands in for a file's lines, or introduces them: loading,
   *  large, failed, nothing for git to print, or changes only. */
  | { key: string; kind: 'file-notice'; file: string; estimate: number }
  | {
      key: string;
      kind: 'comments';
      file: string;
      threads: RemoteCommentThread[];
      drafts: ReviewComment[];
      /** The reviewer's own drafts ending on this line. */
      mine: InlineTarget[];
      /** Indent under the gutter (unified view). */
      indent: boolean;
    }
  | {
      key: string;
      kind: 'orphans';
      file: string;
      threads: RemoteCommentThread[];
      drafts: ReviewComment[];
      mine: InlineTarget[];
    };

/** Rough pixel heights per row kind; the virtualizer refines them by
 *  measuring rendered rows. Code rows are the exact leading-5 height. */
export function estimateRowHeight(row: FlatRow): number {
  switch (row.kind) {
    case 'unified':
    case 'split-context':
    case 'split-pair':
      return 20;
    case 'hunk':
      return 20;
    case 'fold':
      return 24;
    case 'file-header':
      return 37;
    case 'file-notice':
      return row.estimate;
    case 'comments':
    case 'file-drafts':
      return 160;
    case 'orphans':
      return 220;
    case 'conversation':
      return 260;
  }
}

export interface FileDisplayState {
  /** Overrides the collapse-reason default when set. */
  open?: boolean;
  viewed?: boolean;
  expanded?: ReadonlySet<number>;
}

export interface FileStats {
  /** Changed lines, or null when neither Git's listing nor the lines in
   *  hand can say: a file past a cut listing, not read yet. */
  adds: number | null;
  dels: number | null;
  openThreads: number;
  draftCount: number;
  /** The reviewer's own drafts on this file, lines and whole file. */
  mineCount: number;
  collapseReason: CollapseReason;
  open: boolean;
  viewed: boolean;
}

export interface FlatDiff {
  rows: FlatRow[];
  /** Comment/draft id → row index (the comments/orphans/conversation
   *  row containing it). */
  indexById: Map<string, number>;
  /** File → its header row index. */
  fileIndex: Map<string, number>;
  /** Per-file header data. */
  stats: Map<string, FileStats>;
}

/** A notice row, sized for what it stands in for so a file that loads
 *  under the reader moves the rest as little as it can. */
export function noticeRow(
  file: string,
  stats: FileStats,
  body?: FileBody
): FlatRow {
  const lines = (stats.adds ?? 0) + (stats.dels ?? 0);
  const image = body?.state === 'no-text' && body.images === true;
  return {
    key: `n:${file}`,
    kind: 'file-notice',
    file,
    estimate: image ? IMAGE_ROW_HEIGHT : Math.min(36 + lines * 20, 1200),
  };
}

export interface FlatDiffOptions {
  view: 'unified' | 'split';
  hideResolved: boolean;
  hasConversation: boolean;
  generalThreads: readonly RemoteCommentThread[];
  threadsByFile: ReadonlyMap<string, RemoteCommentThread[]>;
  draftsByFile: ReadonlyMap<string, ReviewComment[]>;
  /** The reviewer's own inline drafts, open composers included. */
  mineByFile?: ReadonlyMap<string, InlineTarget[]>;
  /** How many of those each file holds, kept ones only, for its header. */
  mineCount?: ReadonlyMap<string, number>;
  fileState: ReadonlyMap<string, FileDisplayState>;
  /** A pull request's per-file bodies; absent when every file's lines
   *  are already in hand (a worktree's diff). */
  bodies?: ReadonlyMap<string, FileBody>;
  /** Changed-line counts from the manifest, which hold before a body is
   *  read and so keep headers steady while it loads. */
  counts?: ReadonlyMap<string, { additions: number; deletions: number }>;
  /** The sides whose line numbers are the ones comments anchor to: the
   *  pull request's merge base (LEFT) and head (RIGHT). Two other
   *  revisions number their lines otherwise, so a comment on a side
   *  they replace goes under its file, never onto whatever line has
   *  its number. Both, when absent. */
  anchored?: Readonly<Record<'LEFT' | 'RIGHT', boolean>>;
}

/**
 * The files with rows among `indices`, and those of them to read: a file
 * showing only its header (and any comments on the whole file) is
 * collapsed — a lockfile, generated code, a very large diff — and is
 * read once it is opened, not because its header scrolled past.
 */
export function filesOnScreen(
  rows: readonly FlatRow[],
  indices: Iterable<number>
): { shown: Set<string>; toRead: Set<string> } {
  const shown = new Set<string>();
  const toRead = new Set<string>();
  for (const i of indices) {
    const row = rows[i];
    if (!row || !('file' in row)) continue;
    shown.add(row.file);
    if (row.kind !== 'file-header' && row.kind !== 'file-drafts') {
      toRead.add(row.file);
    }
  }
  return { shown, toRead };
}
