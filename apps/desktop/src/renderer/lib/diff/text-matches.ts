import type { DiffLine } from '@n10/diff';

export interface TextMatch {
  file: string;
  index: number;
  start: number;
  end: number;
}

interface OffsetRange {
  start: number;
  end: number;
}

/** Each lowercased code unit points to the original code point it came from. */
function lowercaseOffsets(text: string): OffsetRange[] {
  const offsets: OffsetRange[] = [];
  for (let at = 0; at < text.length; ) {
    const character = String.fromCodePoint(text.codePointAt(at)!);
    const end = at + character.length;
    let units = character.toLocaleLowerCase().length;
    while (units > 0) {
      offsets.push({ start: at, end });
      units--;
    }
    at = end;
  }
  return offsets;
}

/** Literal, case-insensitive occurrences. Offsets remain in the original text. */
export function textRanges(
  text: string,
  query: string
): { start: number; end: number }[] {
  if (!query) return [];
  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const offsets =
    haystack.length === text.length ? null : lowercaseOffsets(text);
  const ranges: { start: number; end: number }[] = [];
  for (let at = 0; at < haystack.length; ) {
    const start = haystack.indexOf(needle, at);
    if (start < 0) break;
    const end = start + needle.length;
    ranges.push({
      start: offsets?.[start]?.start ?? start,
      end: offsets?.[end - 1]?.end ?? end,
    });
    at = end;
  }
  return ranges;
}

/** Counts each source line once, including rows outside the virtual viewport. */
export function diffTextMatches(
  files: readonly [string, DiffLine[]][],
  query: string
): TextMatch[] {
  if (!query) return [];
  const matches: TextMatch[] = [];
  for (const [file, lines] of files) {
    lines.forEach((line, index) => {
      if (line.type === 'hunk-header') return;
      for (const range of textRanges(line.content, query)) {
        matches.push({ file, index, ...range });
      }
    });
  }
  return matches;
}
