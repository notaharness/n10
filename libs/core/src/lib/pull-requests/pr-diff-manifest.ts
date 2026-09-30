import type { DiffChangeStatus } from '@n10/diff';
import { trimToFileBoundary } from '../utils/diff-patch.js';
import { runGit } from '../utils/git-run.js';
import { readBlobSizes } from './blob-sizes.js';
import { OBJECT_ID, type PrComparison } from './pr-comparison.js';

/**
 * What changed in a pull request, file by file, independent of the
 * patch text.
 *
 * The patch is as big as the files it touches (whole-file context), so
 * it has a ceiling, and past it files go missing from anything built
 * on it. The manifest is git's own list of changed paths — a few dozen
 * bytes a file — so it names every file whatever the patch costs, with
 * what git knows about each: both paths of a rename or copy, the
 * modes, the blob ids, and whether the content is binary.
 */

export type ManifestFileKind = 'text' | 'binary' | 'symlink' | 'submodule';

export interface PrDiffManifestFile {
  /** Path in the head; a deleted file's path at the merge base. */
  path: string;
  /** Path at the merge base. Equal to `path` unless renamed or copied. */
  oldPath: string;
  /** `type-changed` is a file that became a symlink, a submodule or
   *  back: git reports it as one change, with no rename. */
  status: DiffChangeStatus;
  /** git's similarity index for a rename or copy, 0–100. */
  similarity: number | null;
  /** Octal modes; null on the side where the file does not exist. */
  oldMode: string | null;
  newMode: string | null;
  /** Blob ids (commit ids for a submodule); null where absent. */
  oldOid: string | null;
  newOid: string | null;
  kind: ManifestFileKind;
  /** Changed lines; null for binary content, or where git's listing
   *  was cut before it counted them. */
  additions: number | null;
  deletions: number | null;
  /** Blob sizes in bytes; null where there is no blob on that side (or
   *  the clone lacks it, as for a submodule's commit). */
  oldSize: number | null;
  newSize: number | null;
}

export interface PrDiffManifest {
  comparison: PrComparison;
  files: PrDiffManifestFile[];
  /** Every changed file is listed. False only when git's listing
   *  reached the ceiling and was cut. */
  complete: boolean;
}

export interface PrDiffPatch {
  text: string;
  /** The patch reached the ceiling and was cut back to its last whole
   *  file: files after the cut are in the manifest but not here. */
  truncated: boolean;
  limitBytes: number;
}

/** The two commits a diff is read between. */
export type PrDiffBounds = Pick<PrComparison, 'mergeBaseOid' | 'headOid'>;

/**
 * Flags that make git's output this parser's format whatever the
 * user's or repository's config says: no colour, no external or
 * textconv drivers, no `diff.noprefix`/`mnemonicPrefix` prefixes, no
 * `diff.relative`, every submodule change listed (`diff.ignoreSubmodules`
 * or an `ignore` in `.gitmodules` would drop them) as the two commits
 * it moved between (`diff.submodule=log` would print a summary instead)
 * — and the same rename detection for the manifest and the patch, so
 * the two list the same files under the same paths.
 *
 * Copies are not detected: `--find-renames` sets rename detection alone,
 * over a `diff.renames=copies` in config. A copy is new code, and git
 * would show it as a small edit of its source — or, copied whole, as
 * nothing at all. Every flag is spelled out: Git refuses an abbreviated
 * one, as newer versions do by default.
 */
const DIFF_FLAGS = [
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--no-relative',
  '--ignore-submodules=none',
  '--submodule=short',
  '--find-renames',
];

/** The manifest's listing: generous, since it costs bytes per file. */
export const MANIFEST_MAX_BYTES = 64 * 1024 * 1024;

/** Whole-file context, the default: comments anywhere in a changed
 *  file have a line to sit on. Git's largest, so no file is longer. */
export const WHOLE_FILE_CONTEXT = 2_147_483_647;

/**
 * Ceiling on one patch read. Whole-file context makes a patch as big
 * as the files it touches, and the host holds the chunks, their
 * concatenation and the string at once; past the ceiling the patch is
 * cut back to a file boundary and says so. It streams through `runGit`
 * because `execFile` discards everything it read on overflow.
 */
export const PATCH_MAX_BYTES = 64 * 1024 * 1024;

const SYMLINK = '120000';
const GITLINK = '160000';
const NO_MODE = '000000';
const NO_OID = /^0+$/;

const STATUS: Record<string, PrDiffManifestFile['status']> = {
  A: 'added',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
};

function requireBounds(bounds: PrDiffBounds): void {
  for (const oid of [bounds.mergeBaseOid, bounds.headOid]) {
    if (!OBJECT_ID.test(oid)) throw new Error(`Not an object id: ${oid}`);
  }
}

function kindOf(
  oldMode: string | null,
  newMode: string | null,
  binary: boolean
): ManifestFileKind {
  if (oldMode === GITLINK || newMode === GITLINK) return 'submodule';
  if (oldMode === SYMLINK || newMode === SYMLINK) return 'symlink';
  return binary ? 'binary' : 'text';
}

type RawRecord = Omit<
  PrDiffManifestFile,
  'kind' | 'additions' | 'deletions' | 'oldSize' | 'newSize'
>;

/** A mode or object id, or null where git writes zeros for "absent". */
const present = (value: string, absent: RegExp | string) =>
  (typeof absent === 'string' ? value === absent : absent.test(value))
    ? null
    : value;

/** One `:old new oldOid newOid status` record and its path(s). */
function rawRecord(meta: string, paths: string[]): RawRecord | null {
  const [oldMode, newMode, oldOid, newOid, code] = meta.slice(1).split(' ');
  const status = STATUS[code?.[0] ?? ''];
  if (!oldMode || !newMode || !oldOid || !newOid || !status) return null;
  const twoPaths = status === 'renamed' || status === 'copied';
  return {
    path: paths[twoPaths ? 1 : 0]!,
    oldPath: paths[0]!,
    status,
    similarity: twoPaths ? parseInt(code!.slice(1), 10) : null,
    oldMode: present(oldMode, NO_MODE),
    newMode: present(newMode, NO_MODE),
    oldOid: present(oldOid, NO_OID),
    newOid: present(newOid, NO_OID),
  };
}

/** The raw section; returns the records and where numstat begins. */
function readRawRecords(tokens: string[]): { raws: RawRecord[]; next: number } {
  const raws: RawRecord[] = [];
  let i = 0;
  while (i < tokens.length && tokens[i]!.startsWith(':')) {
    const meta = tokens[i]!;
    const width = /\s[RC]\d*$/.test(meta) ? 2 : 1;
    const paths = tokens.slice(i + 1, i + 1 + width);
    i += 1 + width;
    if (paths.length < width) break;
    const record = rawRecord(meta, paths);
    if (record) raws.push(record);
  }
  return { raws, next: i };
}

type Counts = [number | null, number | null];

/** The numstat section, one entry per raw record, in the same order. */
function readCounts(tokens: string[], start: number, max: number): Counts[] {
  const counts: Counts[] = [];
  const n = (s: string) => (s === '-' ? null : parseInt(s, 10));
  let i = start;
  while (i < tokens.length && counts.length < max) {
    const [adds, dels, path] = tokens[i]!.split('\t');
    if (adds === undefined || dels === undefined || path === undefined) break;
    i += path === '' ? 3 : 1;
    counts.push([n(adds), n(dels)]);
  }
  return counts;
}

/**
 * Parse `git diff -z --raw --numstat`: every raw record first, then a
 * numstat record per file in the same order. Raw records are
 * `:meta\0path\0` (`\0old\0new\0` for a rename or copy); numstat ones
 * `adds\tdels\tpath\0`, or `adds\tdels\t\0old\0new\0`, with `-` counts
 * for binary content. A record cut by the ceiling is dropped.
 */
export function parseManifestListing(text: string): PrDiffManifestFile[] {
  const tokens = text.split('\0');
  // Every token is NUL-terminated, so the last one is empty — or, in a
  // listing cut by the ceiling, a path with its end missing.
  tokens.pop();
  const { raws, next } = readRawRecords(tokens);
  const counts = readCounts(tokens, next, raws.length);
  return raws.map((raw, index) => {
    const counted = counts[index];
    const [additions, deletions] = counted ?? [null, null];
    return {
      ...raw,
      kind: kindOf(
        raw.oldMode,
        raw.newMode,
        counted !== undefined && additions === null
      ),
      additions,
      deletions,
      oldSize: null,
      newSize: null,
    };
  });
}

/** Every file that changed between the comparison's merge base and
 *  head. A commit-to-commit diff: it reads objects, never the index. */
export async function readPrDiffManifest(
  cwd: string,
  comparison: PrComparison,
  opts: { maxBytes?: number } = {}
): Promise<PrDiffManifest> {
  requireBounds(comparison);
  const { text, truncated } = await runGit(
    [
      'diff',
      ...DIFF_FLAGS,
      '-z',
      '--raw',
      '--numstat',
      '--no-abbrev',
      comparison.mergeBaseOid,
      comparison.headOid,
    ],
    { cwd, maxBytes: opts.maxBytes ?? MANIFEST_MAX_BYTES }
  );
  const files = parseManifestListing(text);
  const sizes = await readBlobSizes(
    cwd,
    files.flatMap((f) => [f.oldOid, f.newOid]).filter((o) => o !== null)
  );
  const size = (oid: string | null) =>
    oid === null ? null : sizes.get(oid) ?? null;
  return {
    comparison,
    files: files.map((f) => ({
      ...f,
      oldSize: size(f.oldOid),
      newSize: size(f.newOid),
    })),
    complete: !truncated,
  };
}

/**
 * The patch between a comparison's merge base and head, for every file
 * or only `paths`. A path is matched literally: `*` or `:(glob)` in a
 * file name is just a character. Ask for a rename by both of its
 * paths, or git sees an addition.
 *
 * Whole-file context unless `context` says otherwise: a smaller one
 * bounds a large file's patch by what changed rather than by its size.
 */
export async function readPrDiffPatch(
  cwd: string,
  bounds: PrDiffBounds,
  opts: { paths?: readonly string[]; context?: number } = {}
): Promise<PrDiffPatch> {
  requireBounds(bounds);
  const context = opts.context ?? WHOLE_FILE_CONTEXT;
  if (
    !Number.isInteger(context) ||
    context < 0 ||
    context > WHOLE_FILE_CONTEXT
  ) {
    throw new Error(`Not a context line count: ${context}`);
  }
  const pathspec = opts.paths?.length
    ? ['--', ...opts.paths.map((p) => `:(literal)${p}`)]
    : [];
  const { text, truncated } = await runGit(
    [
      'diff',
      ...DIFF_FLAGS,
      '--src-prefix=a/',
      '--dst-prefix=b/',
      `-U${context}`,
      bounds.mergeBaseOid,
      bounds.headOid,
      ...pathspec,
    ],
    { cwd, maxBytes: PATCH_MAX_BYTES }
  );
  return {
    text: truncated ? trimToFileBoundary(text) : text,
    truncated,
    limitBytes: PATCH_MAX_BYTES,
  };
}
