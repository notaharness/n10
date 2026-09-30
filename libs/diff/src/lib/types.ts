export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk-header';
  content: string;
  oldLine?: number;
  newLine?: number;
  /** The last line of its side, with no newline after it (git's
   *  `\ No newline at end of file`). */
  noNewline?: boolean;
}

/** How git says a file changed between two revisions. */
export type DiffChangeStatus =
  | 'added'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'copied'
  /** A file that became a symlink or a submodule, or back. */
  | 'type-changed';

/**
 * One file of a patch, with what its header says as well as its lines.
 *
 * A pure rename, a mode change and a binary change have no lines at
 * all; the header is the only record that anything happened to them.
 */
export interface ParsedDiffFile {
  /** Path in the new revision; a deleted file's path in the old one. */
  path: string;
  /** Path in the old revision. Equal to `path` unless renamed or copied. */
  oldPath: string;
  status: DiffChangeStatus;
  /** git's similarity index for a rename or copy, 0–100. */
  similarity?: number;
  /** Octal file modes as git writes them (`100644`, `100755`, `120000`
   *  for a symlink, `160000` for a submodule). Absent when unknown. */
  oldMode?: string;
  newMode?: string;
  /** git reported the content as binary: there are no lines to show. */
  binary: boolean;
  lines: DiffLine[];
}

export interface FileDiff {
  filename: string;
  lines: DiffLine[];
}

export interface DiffFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed';
  additions: number;
  deletions: number;
  binary: boolean;
  previousFilename?: string;
}

export type FileCategory = 'normal' | 'binary' | 'lockfile' | 'generated';
