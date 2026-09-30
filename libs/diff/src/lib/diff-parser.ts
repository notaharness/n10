import { headerPaths, markerPath, unquoteGitPath } from './git-path.js';
import type { DiffLine, ParsedDiffFile } from './types.js';

/** How far through each side of the file the walk has got. */
interface LineCursor {
  oldLine: number;
  newLine: number;
}

/** Lines of the current hunk not yet read, per side, as its header
 *  declared them. Null when the header could not be read. */
interface HunkBudget {
  old: number;
  new: number;
}

/**
 * Split the diff into the lines the parser walks, with the two artefacts of
 * the transport removed.
 */
function normalizeDiffLines(diffText: string): string[] {
  const rawLines = diffText.split('\n');

  // `git diff` output ends with a newline, so splitting leaves a final
  // empty string. An empty line is otherwise read as unchanged context
  // below, which appended a blank row to the last file of every diff —
  // numbered one past the end of the file. Harmless to look at, but it
  // claims a line that does not exist, and comment anchoring resolves
  // against exactly these numbers.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  // Strip any trailing CR — CRLF source files leave \r on every diff
  // line, which when rendered drives wterm's cursor back to column 0
  // mid-row and overlays the next row's content visually (the
  // "&&duction'" / ",d," mangling users reported).
  return rawLines.map((line) =>
    line.endsWith('\r') ? line.slice(0, -1) : line
  );
}

/** `@@ -old,count +new,count @@`, where an omitted count means 1. */
function parseHunkHeader(
  rawLine: string
): { start: LineCursor; budget: HunkBudget } | null {
  const match = rawLine.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return null;
  return {
    start: {
      oldLine: parseInt(match[1]!, 10),
      newLine: parseInt(match[3]!, 10),
    },
    budget: {
      old: match[2] === undefined ? 1 : parseInt(match[2], 10),
      new: match[4] === undefined ? 1 : parseInt(match[4], 10),
    },
  };
}

/**
 * Classify one body line and advance the cursor past it: an addition
 * consumes a line of the new file, a removal one of the old, context both.
 * Anything else is not a body line.
 */
function parseContentLine(
  rawLine: string,
  cursor: LineCursor
): DiffLine | null {
  if (rawLine.startsWith('+')) {
    return {
      type: 'add',
      content: rawLine.slice(1),
      newLine: cursor.newLine++,
    };
  }
  if (rawLine.startsWith('-')) {
    return {
      type: 'remove',
      content: rawLine.slice(1),
      oldLine: cursor.oldLine++,
    };
  }
  if (rawLine.startsWith(' ') || rawLine === '') {
    return {
      type: 'context',
      // A wholly blank context line has no marker space to strip.
      content: rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine,
      oldLine: cursor.oldLine++,
      newLine: cursor.newLine++,
    };
  }
  return null;
}

/** Everything a file's extended header says, gathered before the
 *  file's paths and status are settled. */
interface FileHeader {
  fromHeader: { oldPath: string; newPath: string } | null;
  /** From `--- a/x` / `+++ b/x`; null is `/dev/null`. */
  markerOld?: string | null;
  markerNew?: string | null;
  renameFrom?: string;
  renameTo?: string;
  copyFrom?: string;
  copyTo?: string;
  created: boolean;
  deleted: boolean;
  similarity?: number;
  oldMode?: string;
  newMode?: string;
  binary: boolean;
}

function emptyHeader(line: string): FileHeader {
  return {
    fromHeader: headerPaths(line),
    created: false,
    deleted: false,
    binary: false,
  };
}

/** Extended header lines, keyed by their fixed prefix. */
const HEADER_FIELDS: [string, (h: FileHeader, rest: string) => void][] = [
  ['--- ', (h, rest) => (h.markerOld = markerPath(rest, 'a/'))],
  ['+++ ', (h, rest) => (h.markerNew = markerPath(rest, 'b/'))],
  ['rename from ', (h, rest) => (h.renameFrom = unquoteGitPath(rest))],
  ['rename to ', (h, rest) => (h.renameTo = unquoteGitPath(rest))],
  ['copy from ', (h, rest) => (h.copyFrom = unquoteGitPath(rest))],
  ['copy to ', (h, rest) => (h.copyTo = unquoteGitPath(rest))],
  ['similarity index ', (h, rest) => (h.similarity = parseInt(rest, 10))],
  ['old mode ', (h, rest) => (h.oldMode = rest)],
  ['new mode ', (h, rest) => (h.newMode = rest)],
  [
    'new file mode ',
    (h, rest) => {
      h.created = true;
      h.newMode = rest;
    },
  ],
  [
    'deleted file mode ',
    (h, rest) => {
      h.deleted = true;
      h.oldMode = rest;
    },
  ],
  [
    // `index abc..def 100644`: the mode is shared by both sides.
    'index ',
    (h, rest) => {
      const mode = rest.split(' ')[1];
      if (mode) {
        h.oldMode ??= mode;
        h.newMode ??= mode;
      }
    },
  ],
  ['Binary files ', (h) => (h.binary = true)],
  ['GIT binary patch', (h) => (h.binary = true)],
];

function readHeaderLine(header: FileHeader, rawLine: string): void {
  for (const [prefix, apply] of HEADER_FIELDS) {
    if (rawLine.startsWith(prefix)) {
      apply(header, rawLine.slice(prefix.length));
      return;
    }
  }
}

function settleStatus(header: FileHeader): ParsedDiffFile['status'] {
  if (header.created) return 'added';
  if (header.deleted) return 'deleted';
  if (header.renameFrom !== undefined) return 'renamed';
  if (header.copyFrom !== undefined) return 'copied';
  return 'modified';
}

/** The rename and copy lines name paths exactly; the ---/+++ markers
 *  next; the `diff --git` line only when neither is there. */
function settlePaths(header: FileHeader): { oldPath: string; newPath: string } {
  const newPath =
    header.renameTo ??
    header.copyTo ??
    header.markerNew ??
    header.fromHeader?.newPath ??
    '';
  const oldPath =
    header.renameFrom ??
    header.copyFrom ??
    header.markerOld ??
    header.fromHeader?.oldPath ??
    newPath;
  return { oldPath, newPath };
}

/** Modes a side actually has: an added file has no old one. */
function settleModes(
  header: FileHeader
): Pick<ParsedDiffFile, 'oldMode' | 'newMode'> {
  const modes: Pick<ParsedDiffFile, 'oldMode' | 'newMode'> = {};
  if (!header.created && header.oldMode) modes.oldMode = header.oldMode;
  if (!header.deleted && header.newMode) modes.newMode = header.newMode;
  return modes;
}

/** Settle a file's paths and status from everything its header said. */
function settle(header: FileHeader, lines: DiffLine[]): ParsedDiffFile {
  const status = settleStatus(header);
  const { oldPath, newPath } = settlePaths(header);
  const path = status === 'deleted' ? oldPath : newPath;
  const oneSided = status === 'added' || status === 'deleted';
  return {
    path,
    oldPath: oneSided ? path : oldPath,
    status,
    ...(header.similarity === undefined
      ? {}
      : { similarity: header.similarity }),
    ...settleModes(header),
    binary: header.binary,
    lines,
  };
}

/**
 * Walks a patch one line at a time. A hunk's body is read by the counts
 * its header declares rather than by what each line looks like: an
 * added line reading `++ x` arrives as `+++ x`, and a removed SQL
 * comment `-- x` as `--- x`, both indistinguishable from a file header
 * by prefix alone.
 */
class PatchWalker {
  readonly files: ParsedDiffFile[] = [];
  private header: FileHeader | null = null;
  private lines: DiffLine[] = [];
  private readonly cursor: LineCursor = { oldLine: 0, newLine: 0 };
  /** Null outside a hunk; `unbounded` inside one whose header did not
   *  parse, read by prefix until the next header. */
  private budget: HunkBudget | 'unbounded' | null = null;

  line(rawLine: string): void {
    if (this.inBody() && this.bodyLine(rawLine)) return;
    this.budget = null;
    if (rawLine.startsWith('diff --git ')) {
      this.finish();
      this.header = emptyHeader(rawLine);
      this.lines = [];
    } else if (rawLine.startsWith('@@')) {
      this.hunk(rawLine);
    } else if (rawLine.startsWith('\\')) {
      this.markNoNewline();
    } else if (this.header) {
      readHeaderLine(this.header, rawLine);
    }
  }

  finish(): void {
    if (this.header) this.push(settle(this.header, this.lines));
    this.header = null;
  }

  /**
   * git writes a type change — a file that became a symlink, say — as
   * two sections for one path: the old content deleted, then the new
   * added. They are one change to one file, and keyed by path the
   * second would replace the first and lose the removed lines.
   */
  private push(file: ParsedDiffFile): void {
    const prev = this.files[this.files.length - 1];
    if (
      prev?.status === 'deleted' &&
      file.status === 'added' &&
      prev.path === file.path
    ) {
      this.files[this.files.length - 1] = {
        path: file.path,
        oldPath: prev.oldPath,
        status: 'type-changed',
        ...(prev.oldMode ? { oldMode: prev.oldMode } : {}),
        ...(file.newMode ? { newMode: file.newMode } : {}),
        binary: prev.binary || file.binary,
        lines: [...prev.lines, ...file.lines],
      };
      return;
    }
    this.files.push(file);
  }

  private inBody(): boolean {
    if (this.budget === null) return false;
    if (this.budget === 'unbounded') return true;
    return this.budget.old > 0 || this.budget.new > 0;
  }

  /** Read a hunk body line; false when `rawLine` is not one. */
  private bodyLine(rawLine: string): boolean {
    if (rawLine.startsWith('\\')) {
      this.markNoNewline();
      return true;
    }
    if (this.budget === 'unbounded' && rawLine.startsWith('diff --git ')) {
      return false;
    }
    const line = parseContentLine(rawLine, this.cursor);
    if (!line) return false;
    if (this.budget !== 'unbounded' && this.budget) {
      if (line.type !== 'add') this.budget.old--;
      if (line.type !== 'remove') this.budget.new--;
    }
    if (this.header) this.lines.push(line);
    return true;
  }

  /** A hunk header is kept as a row even when it does not parse, so the
   *  rendered diff still shows the separator it came with. */
  private hunk(rawLine: string): void {
    const parsed = parseHunkHeader(rawLine);
    if (parsed) {
      this.cursor.oldLine = parsed.start.oldLine;
      this.cursor.newLine = parsed.start.newLine;
    }
    this.budget = parsed ? parsed.budget : 'unbounded';
    this.lines.push({ type: 'hunk-header', content: rawLine });
  }

  /** `\ No newline at end of file` refers to the line just before it,
   *  and consumes no line number of its own. */
  private markNoNewline(): void {
    const last = this.lines[this.lines.length - 1];
    if (last && last.type !== 'hunk-header') last.noNewline = true;
  }
}

/**
 * Parse a unified diff into its files, each with the metadata its
 * header carries: paths on both sides, status, similarity, modes and
 * whether git called it binary.
 */
export function parseDiffFiles(diffText: string): ParsedDiffFile[] {
  const walker = new PatchWalker();
  for (const rawLine of normalizeDiffLines(diffText)) walker.line(rawLine);
  walker.finish();
  return walker.files;
}

/**
 * Parse a unified diff text into per-file line lists, keyed by the
 * file's path in the new revision (the old one for a deleted file).
 */
export function parseUnifiedDiff(diffText: string): Map<string, DiffLine[]> {
  const result = new Map<string, DiffLine[]>();
  for (const file of parseDiffFiles(diffText)) {
    result.set(file.path, file.lines);
  }
  return result;
}
