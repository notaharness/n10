import type { DiffChangeStatus, DiffLine, ParsedDiffFile } from '@n10/diff';
import type { PrDiffManifestFile } from '../../../host/contract.js';

/**
 * Which files of a pull request to read together, and what each file's
 * body is at any moment.
 *
 * The manifest lists every file before any patch is read. Bodies are
 * read in batches bounded by size, so no single read approaches the
 * patch ceiling and a small file is never lost behind a big one. A file
 * whose larger side passes `LARGE_FILE_BYTES` is not read until the
 * reader asks — either its changes alone, bounded by what changed, or
 * the whole file. A file git has no lines for (binary content, a pure
 * rename, a mode change) is never read at all.
 *
 * Git pairs renames among the files a read names, and a subset can pair
 * them otherwise than the whole pull request did: past
 * `diff.renameLimit`, or with fewer candidates for each file than Git
 * weighed across the whole of it. So deleted files, renamed or copied
 * ones, and everything else batch apart: the last lane names no path a
 * rename could start from. Each read is still checked against the
 * manifest (`mispaired`), and a file it paired otherwise is read again
 * alone, by its own paths.
 */

/** Past this on its larger side, a file is read only when asked. */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;
/** A batch stops gathering files at this combined size… */
export const BATCH_BYTES = 4 * 1024 * 1024;
/** …or at this many files, whichever comes first. */
export const BATCH_FILES = 100;
/** Context around each change when a large file is read by its changes. */
export const CHANGES_CONTEXT = 3;

/** A file as the manifest lists it: what a read of it must agree with. */
export interface FileShape {
  oldPath: string;
  status: DiffChangeStatus;
}

export interface DiffBatch {
  id: string;
  /** Manifest paths this batch answers for. */
  files: string[];
  /** What git is asked for: both paths of each rename or copy. */
  pathspec: string[];
  bytes: number;
  /** Each file's manifest shape, by path. */
  shapes: ReadonlyMap<string, FileShape>;
}

/** How much of a large file to read. */
export type LargeScope = 'changes' | 'whole-file';

export type FileBody =
  /** Lines to show. `changes` is a large file read by its changes. */
  | { state: 'loaded'; lines: DiffLine[]; scope: LargeScope }
  | { state: 'loading' }
  /** git has no lines for it: nothing to read. `images`: binary content
   *  shown as pictures (`showsImages`), and how many sides it has: one
   *  when the change added or deleted the file. The one test both the
   *  row's height and what renders in it go by. */
  | {
      state: 'no-text';
      reason: 'binary' | 'no-content-changes';
      images?: ImageSides;
    }
  /** Too big to read unasked; `bytes` is its larger side. */
  | { state: 'large'; bytes: number }
  /** `cut`: its batch's read stopped before it; read alone, it may fit. */
  | { state: 'error'; message: string; cut?: boolean }
  /** Its patch, read alone at `scope`, passed the ceiling. */
  | { state: 'too-large'; limitBytes: number; scope: LargeScope };

/** The larger side of a file, which is what a whole-file patch costs. */
export function fileBytes(file: PrDiffManifestFile): number {
  return Math.max(file.oldSize ?? 0, file.newSize ?? 0);
}

/** A file with nothing for git to print: read nothing. */
export function noTextReason(
  file: PrDiffManifestFile
): 'binary' | 'no-content-changes' | null {
  if (file.kind === 'binary') return 'binary';
  if (file.additions === 0 && file.deletions === 0) return 'no-content-changes';
  return null;
}

/** File names whose binary content the diff shows as pictures: the
 *  formats the host recognises by their leading bytes. */
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
]);

export function isImagePath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** A binary file shown as its images instead of a notice. */
export function showsImages(file: PrDiffManifestFile): boolean {
  return (
    file.kind === 'binary' &&
    (isImagePath(file.path) || isImagePath(file.oldPath))
  );
}

/** How many sides a changed image has: before and after, or only one
 *  when the change added or deleted it. */
export type ImageSides = 1 | 2;

export function imageSides(file: PrDiffManifestFile): ImageSides {
  return file.oldOid !== null && file.newOid !== null ? 2 : 1;
}

/** Each side's frame, fixed before either image is read so nothing
 *  below moves when one arrives. */
export const IMAGE_FRAME_HEIGHT = 320;
/** A side's caption: one `h-4` line and its `mb-1.5` (6). */
const IMAGE_CAPTION_HEIGHT = 16 + 6;
/** The row's `py-3`. */
const IMAGE_ROW_PADDING = 2 * 12;
/** The choice of how two sides are compared: one `h-7` line (28) and
 *  its `mb-2` (8). A one-sided image has nothing to compare. */
const IMAGE_MODES_HEIGHT = 28 + 8;

/** The frame, its caption, the row's padding and, for two sides, the
 *  choice of how they are compared. */
export function imageRowHeight(sides: ImageSides): number {
  return (
    IMAGE_ROW_PADDING +
    (sides === 2 ? IMAGE_MODES_HEIGHT : 0) +
    IMAGE_CAPTION_HEIGHT +
    IMAGE_FRAME_HEIGHT
  );
}

export function isLarge(file: PrDiffManifestFile): boolean {
  return noTextReason(file) === null && fileBytes(file) > LARGE_FILE_BYTES;
}

/** What git is asked for to read one file: both paths of a rename. */
export function pathspecOf(file: { path: string; oldPath: string }): string[] {
  return file.oldPath === file.path ? [file.path] : [file.oldPath, file.path];
}

/** Files that batch together: see above. */
type Lane = 'deleted' | 'renamed' | 'rest';

function laneOf(file: PrDiffManifestFile): Lane {
  if (file.status === 'deleted') return 'deleted';
  if (file.status === 'renamed' || file.status === 'copied') return 'renamed';
  return 'rest';
}

const shapeOf = (file: PrDiffManifestFile): FileShape => ({
  oldPath: file.oldPath,
  status: file.status,
});

/** The files a read described otherwise than the manifest: paired with
 *  another path, or not paired as it was. */
export function mispaired(
  batch: DiffBatch,
  parsed: ReadonlyMap<string, Pick<ParsedDiffFile, 'oldPath' | 'status'>>
): string[] {
  return batch.files.filter((path) => {
    const read = parsed.get(path);
    const shape = batch.shapes.get(path);
    return (
      read !== undefined &&
      shape !== undefined &&
      (read.oldPath !== shape.oldPath || read.status !== shape.status)
    );
  });
}

/**
 * Split the readable, not-large files into batches, in manifest order
 * within each lane. Deterministic: the same manifest always gives the
 * same batches, so a batch's id is a stable cache key.
 */
export function planBatches(
  files: readonly PrDiffManifestFile[],
  limits: { bytes: number; files: number } = {
    bytes: BATCH_BYTES,
    files: BATCH_FILES,
  }
): DiffBatch[] {
  const batches: DiffBatch[] = [];
  const open = new Map<Lane, DiffBatch>();
  for (const file of files) {
    if (noTextReason(file) !== null || isLarge(file)) continue;
    const lane = laneOf(file);
    const bytes = fileBytes(file);
    let current = open.get(lane);
    const full =
      current !== undefined &&
      (current.files.length >= limits.files ||
        current.bytes + bytes > limits.bytes);
    if (current === undefined || full) {
      current = {
        id: `b${batches.length}:${file.path}`,
        files: [],
        pathspec: [],
        bytes: 0,
        shapes: new Map(),
      };
      batches.push(current);
      open.set(lane, current);
    }
    current.files.push(file.path);
    current.pathspec.push(...pathspecOf(file));
    current.bytes += bytes;
    (current.shapes as Map<string, FileShape>).set(file.path, shapeOf(file));
  }
  return batches;
}

/**
 * One file read on its own, at the scope the reader chose: a large
 * file, or one cut from its batch's read.
 */
export function aloneBatch(
  file: PrDiffManifestFile,
  scope: LargeScope
): DiffBatch {
  return {
    id: `alone:${scope}:${file.path}`,
    files: [file.path],
    pathspec: pathspecOf(file),
    bytes: fileBytes(file),
    shapes: new Map([[file.path, shapeOf(file)]]),
  };
}

/** What a read of one batch has come to. */
export type BatchRead =
  | { status: 'idle' | 'pending' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      files: ReadonlyMap<string, ParsedDiffFile>;
      truncated: boolean;
      limitBytes: number;
      scope: LargeScope;
      /** The read named this one file: a cut says it alone is too big. */
      alone: boolean;
    };

/**
 * One file's body from the read of the batch it is in, or null when it
 * is in none (no text, or large and not asked for).
 */
export function bodyOf(
  file: PrDiffManifestFile,
  read: BatchRead | null
): FileBody {
  const reason = noTextReason(file);
  if (reason) {
    return showsImages(file)
      ? { state: 'no-text', reason, images: imageSides(file) }
      : { state: 'no-text', reason };
  }
  if (read === null) return { state: 'large', bytes: fileBytes(file) };
  if (read.status === 'error') return { state: 'error', message: read.message };
  if (read.status !== 'success') return { state: 'loading' };
  const parsed = read.files.get(file.path);
  if (parsed) {
    return { state: 'loaded', lines: parsed.lines, scope: read.scope };
  }
  if (read.truncated && read.alone) {
    return {
      state: 'too-large',
      limitBytes: read.limitBytes,
      scope: read.scope,
    };
  }
  if (read.truncated) {
    return {
      state: 'error',
      message: 'the read of the files around it stopped before this one',
      cut: true,
    };
  }
  return {
    state: 'error',
    message: 'git returned no patch for this file at these commits',
  };
}
