import { isOid, type LineRange, type Oid } from '@n10/vcs-core';

/**
 * Where a review comment on code was written: the file, the lines on
 * one side of the diff, the commit they were read at, and the lines
 * themselves as they were then. The text is kept so the draft can show
 * what it was about after the code moves, and so a later publisher can
 * tell whether the same line numbers still hold the same code — it must
 * never post to a line number that now holds something else.
 */
export interface DraftAnchor {
  path: string;
  /** The file's path before a rename, when the diff names one. */
  previousPath: string | null;
  /** The lines, on one side; null for a comment on the whole file. */
  range: LineRange | null;
  /** The head commit the diff showed, when it named a full one. */
  head: Oid | null;
  /** The range's lines as written then; empty for the whole file. */
  lines: string[];
}

/** More than any comment range a reviewer selects by hand. */
const MAX_LINES = 2_000;

const isSide = (v: unknown) => v === 'LEFT' || v === 'RIGHT';
const isLine = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

/** One side only: a comment runs down the old file or the new one. */
function parseRange(value: unknown): LineRange | null {
  if (value === null) return null;
  const r = (value ?? {}) as Record<string, unknown>;
  const { startSide, start, side, end } = r;
  if (
    !isSide(side) ||
    startSide !== side ||
    !isLine(start) ||
    !isLine(end) ||
    (start as number) > (end as number)
  ) {
    throw new TypeError('Invalid draft range');
  }
  return {
    startSide: side as LineRange['side'],
    start: start as number,
    side: side as LineRange['side'],
    end: end as number,
  };
}

function parseLines(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_LINES ||
    !value.every((l) => typeof l === 'string')
  ) {
    throw new TypeError('Invalid draft lines');
  }
  return value as string[];
}

/** An anchor from untrusted input. Throws on anything off. */
export function parseAnchor(value: unknown): DraftAnchor {
  const a = (value ?? {}) as Record<string, unknown>;
  const { path, previousPath, head } = a;
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('Invalid draft path');
  }
  if (previousPath !== null && typeof previousPath !== 'string') {
    throw new TypeError('Invalid draft previous path');
  }
  if (head !== null && !isOid(head)) throw new TypeError('Invalid draft head');
  const range = parseRange(a['range']);
  const lines = parseLines(a['lines']);
  return { path, previousPath, range, head, lines };
}
