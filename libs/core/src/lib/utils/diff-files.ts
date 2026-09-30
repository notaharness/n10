import type { DiffFile } from '@n10/diff';
import { runGit } from './git-run.js';

function mapNameStatus(letter: string): DiffFile['status'] {
  const code = letter.charAt(0);
  switch (code) {
    case 'A':
      return 'added';
    case 'D':
      return 'removed';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'changed';
    default:
      return 'modified';
  }
}

interface NumstatEntry {
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * Parse `git diff --numstat -z` into per-path line counts.
 *
 * `-z` terminates each record with NUL instead of a newline, and — the
 * reason it is used — reports a rename's two paths as their own records
 * rather than folding them into one display string. Without it git emits
 * `src/{old.ts => new.ts}`, which contains neither full path, and the
 * join against name-status silently reported +0 -0 for any file moved
 * within its own directory.
 *
 * A record is `<added>\t<deleted>\t<path>`, or `-\t-\t<path>` for a
 * binary file, which has no line counts to report. For a rename or copy
 * the path is empty and the old and new paths follow as the next two
 * records; both are filed, so either side of the pair finds the counts.
 *
 * `-z` also turns off path quoting, so a path arrives raw and may itself
 * contain a tab — hence everything past the two counts is the path.
 */
function parseNumstat(stdout: string): Map<string, NumstatEntry> {
  const entries = new Map<string, NumstatEntry>();
  const records = stdout.split('\0');
  let i = 0;
  while (i < records.length) {
    const head = records[i++];
    if (!head) continue;
    const parts = head.split('\t');
    if (parts.length < 3) continue;
    const binary = parts[0] === '-' && parts[1] === '-';
    const entry: NumstatEntry = {
      additions: binary ? 0 : Number(parts[0]),
      deletions: binary ? 0 : Number(parts[1]),
      binary,
    };
    const inline = parts.slice(2).join('\t');
    if (inline) {
      entries.set(inline, entry);
      continue;
    }
    const from = records[i++];
    const to = records[i++];
    if (from) entries.set(from, entry);
    if (to) entries.set(to, entry);
  }
  return entries;
}

/** The counts for a file. A rename is filed under both of its paths, so
 *  either side finds it. */
function lookupStats(
  entries: Map<string, NumstatEntry>,
  filename: string,
  previousFilename: string | undefined
): NumstatEntry | undefined {
  return (
    entries.get(filename) ??
    (previousFilename ? entries.get(previousFilename) : undefined)
  );
}

/**
 * Join `git diff --name-status -z` output against the per-file numstat.
 *
 * Under `-z` the status letter and each path are their own NUL-terminated
 * record, so a rename or copy is three records and everything else is
 * two. Nothing is split on tabs, which is what lets a path contain one.
 */
function toDiffFiles(
  stdout: string,
  entries: Map<string, NumstatEntry>
): DiffFile[] {
  const files: DiffFile[] = [];
  const records = stdout.split('\0');
  let i = 0;
  while (i < records.length) {
    const status = records[i++];
    if (!status) continue;
    const renameOrCopy = status.startsWith('R') || status.startsWith('C');
    const previousFilename = renameOrCopy ? records[i++] : undefined;
    const filename = records[i++];
    if (!filename) continue;
    const stats = lookupStats(entries, filename, previousFilename);

    files.push({
      filename,
      status: mapNameStatus(status),
      additions: stats?.additions ?? 0,
      deletions: stats?.deletions ?? 0,
      binary: stats?.binary ?? false,
      previousFilename,
    });
  }
  return files;
}

/** Read metadata at pinned refs; truncated metadata is an error, never a partial list. */
export async function readDiffFiles(
  cwd: string,
  sourceRef: string,
  targetRef: string
): Promise<DiffFile[]> {
  const range = `${targetRef}...${sourceRef}`;
  const [numstat, status] = await Promise.all([
    runGit(['diff', '--numstat', '-z', range], {
      cwd,
      maxBytes: 10 * 1024 * 1024,
    }),
    runGit(['diff', '--name-status', '-z', range], {
      cwd,
      maxBytes: 10 * 1024 * 1024,
    }),
  ]);
  if (numstat.truncated || status.truncated)
    throw new Error('The changed-file list is too large to read');
  return toDiffFiles(status.text, parseNumstat(numstat.text));
}
