import type { ReactNode } from 'react';
import type { CharRange } from '../../../lib/diff/word-diff.js';
import { cn } from '../../../lib/utils.js';

export function shiftRanges(
  ranges: CharRange[] | undefined,
  start: number,
  end: number
): CharRange[] | undefined {
  if (!ranges) return undefined;
  const out: CharRange[] = [];
  for (const r of ranges) {
    const s = Math.max(r.start, start);
    const e = Math.min(r.end, end);
    if (s < e) out.push({ start: s - start, end: e - start });
  }
  return out.length ? out : undefined;
}

function textSegment(
  content: string,
  found: boolean,
  selected: boolean,
  word: boolean,
  active: boolean,
  emphasis: string,
  key: string
): ReactNode {
  if (found && selected)
    return (
      <mark
        key={key}
        data-diff-search-match
        data-diff-selection-match
        data-diff-search-active={active ? 'true' : undefined}
        className={cn(
          'rounded-sm bg-orange-400/60 text-inherit',
          active && 'ring-1 ring-amber-500'
        )}
      >
        {content}
      </mark>
    );
  if (found)
    return (
      <mark
        key={key}
        data-diff-search-match
        data-diff-search-active={active ? 'true' : undefined}
        className={cn(
          'rounded-sm bg-yellow-400/45 text-inherit',
          active && 'ring-1 ring-amber-500'
        )}
      >
        {content}
      </mark>
    );
  if (selected)
    return (
      <mark
        key={key}
        data-diff-selection-match
        className="rounded-sm bg-sky-400/35 text-inherit"
      >
        {content}
      </mark>
    );
  if (word)
    return (
      <mark key={key} className={cn('text-inherit', emphasis)}>
        {content}
      </mark>
    );
  return content;
}

function rangeBoundaries(text: string, groups: CharRange[][]): number[] {
  return [
    ...new Set([
      0,
      text.length,
      ...groups.flatMap((ranges) => ranges.flatMap((r) => [r.start, r.end])),
    ]),
  ].sort((a, b) => a - b);
}

function inRange(
  ranges: CharRange[] | undefined,
  start: number,
  end: number
): boolean {
  return ranges?.some((r) => r.start <= start && end <= r.end) ?? false;
}

function rangeSegments(
  text: string,
  ranges: CharRange[] | undefined,
  search: CharRange[],
  selection: CharRange[],
  activeStart: number | undefined,
  emphasis: string,
  keyPrefix: number | string
): ReactNode[] {
  const out: ReactNode[] = [];
  const boundaries = rangeBoundaries(text, [ranges ?? [], search, selection]);
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const content = text.slice(start, end);
    out.push(
      textSegment(
        content,
        inRange(search, start, end),
        inRange(selection, start, end),
        inRange(ranges, start, end),
        activeStart === start,
        emphasis,
        `${keyPrefix}-${start}`
      )
    );
  }
  return out;
}

export function splitRanges(
  text: string,
  ranges: CharRange[] | undefined,
  emphasis: string,
  keyPrefix: number | string = '',
  search: CharRange[] = [],
  selection: CharRange[] = [],
  activeStart?: number
): ReactNode {
  if (
    (!ranges || ranges.length === 0) &&
    search.length === 0 &&
    selection.length === 0
  )
    return text;
  return rangeSegments(
    text,
    ranges,
    search,
    selection,
    activeStart,
    emphasis,
    keyPrefix
  );
}
