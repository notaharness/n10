import type { DiffLine } from '@n10/diff';
import type { ReviewComment } from './types.js';

/** Where an agent's comment goes: the pull request, a file, or lines. */
export type CommentAnchor = Pick<
  ReviewComment,
  'file' | 'lineStart' | 'lineEnd' | 'side'
>;

export type AnchorResult =
  | { ok: true; anchor: CommentAnchor }
  | { ok: false; error: string };

const isLine = (value: number) => Number.isInteger(value) && value > 0;

function readLines(
  parsed: Record<string, string>
): { start: number; end: number } | string {
  const start = Number(parsed.lineStart);
  const end = parsed.lineEnd === undefined ? start : Number(parsed.lineEnd);
  if (!isLine(start) || !isLine(end))
    return '--lineStart and --lineEnd must be line numbers from 1';
  if (start > end) return '--lineStart must not be after --lineEnd';
  return { start, end };
}

const fail = (error: string): AnchorResult => ({ ok: false, error });

function lineAnchor(
  parsed: Record<string, string>,
  file: string
): AnchorResult {
  const { side } = parsed;
  if (side !== undefined && side !== 'LEFT' && side !== 'RIGHT')
    return fail('Invalid side. Must be LEFT or RIGHT');
  if (parsed.lineStart === undefined)
    return fail(
      side === undefined
        ? '--lineEnd needs --lineStart'
        : '--side needs --lineStart'
    );
  const lines = readLines(parsed);
  if (typeof lines === 'string') return fail(lines);
  return {
    ok: true,
    anchor: {
      file,
      lineStart: lines.start,
      lineEnd: lines.end,
      side: side === 'LEFT' ? 'LEFT' : 'RIGHT',
    },
  };
}

/**
 * The anchor the flags name. No `--file` is the pull request itself;
 * `--file` alone is the whole file; `--lineStart` (and `--lineEnd`,
 * which defaults to it) narrows it to lines on one `--side`.
 */
export function readAnchor(parsed: Record<string, string>): AnchorResult {
  const { file } = parsed;
  const narrowed = ['lineStart', 'lineEnd', 'side'].some(
    (flag) => parsed[flag] !== undefined
  );
  if (file !== undefined && narrowed) return lineAnchor(parsed, file);
  if (narrowed) return fail('--lineStart, --lineEnd and --side need --file');
  return {
    ok: true,
    anchor: {
      file: file ?? null,
      lineStart: null,
      lineEnd: null,
      side: 'RIGHT',
    },
  };
}

/**
 * The runs of lines on `side` a comment can be placed on: each hunk's
 * lines on that side, context included, as the provider shows them.
 */
export function commentableRanges(
  lines: DiffLine[],
  side: 'LEFT' | 'RIGHT'
): [number, number][] {
  const ranges: [number, number][] = [];
  let open = false;
  for (const line of lines) {
    if (line.type === 'hunk-header') {
      open = false;
      continue;
    }
    const n = side === 'LEFT' ? line.oldLine : line.newLine;
    if (n === undefined) continue;
    const last = ranges[ranges.length - 1];
    if (open && last && n === last[1] + 1) last[1] = n;
    else ranges.push([n, n]);
    open = true;
  }
  return ranges;
}

const span = ([start, end]: [number, number]) =>
  start === end ? `${start}` : `${start}-${end}`;

/**
 * Why the pull request's diff cannot take a comment at `anchor`, or
 * null when it can. `lines` is the file's diff, or null when the
 * pull request does not change the file; `at` names the diff.
 */
export function anchorOutsideDiff(
  anchor: CommentAnchor & { file: string },
  lines: DiffLine[] | null,
  at: string
): string | null {
  if (lines === null)
    return (
      `${anchor.file} is not changed in ${at}. Comment on a changed file, ` +
      'or leave out --file to comment on the pull request.'
    );
  const { lineStart, lineEnd, side } = anchor;
  if (lineStart === null || lineEnd === null) return null;
  const ranges = commentableRanges(lines, side);
  if (ranges.some(([start, end]) => start <= lineStart && lineEnd <= end))
    return null;
  const asked = span([lineStart, lineEnd]);
  const open = ranges.length
    ? `Lines in the diff on that side: ${ranges.map(span).join(', ')}.`
    : 'The diff has no lines on that side.';
  return (
    `${anchor.file} line${lineStart === lineEnd ? '' : 's'} ${asked} ` +
    `(${side}) ${lineStart === lineEnd ? 'is' : 'are'} outside ${at}. ` +
    `${open} Keep --lineStart and --lineEnd within one of these, or ` +
    'leave them out to comment on the whole file.'
  );
}
