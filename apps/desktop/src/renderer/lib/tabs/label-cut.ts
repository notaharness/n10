/**
 * Cutting a label to fit a width, from whichever end it can spare: a
 * branch name loses its start, since its last word is what tells it
 * from its neighbours; a title loses its end. CSS cuts only the end in
 * Chromium (`text-overflow` on the start side is Firefox's alone), so
 * both cuts are measured here, the same way.
 */

export const ELLIPSIS = '…';

export type CutSide = 'start' | 'end';

/**
 * How many characters of `text` to drop from `side` so that what is
 * left and `…` fit in `width`, given a `measure` of a string's width:
 * 0 when the whole of it fits, all of it when not even one character
 * does. Counts code points, so a character is never split in two.
 */
export function cutToFit(
  text: string,
  width: number,
  measure: (s: string) => number,
  side: CutSide
): number {
  const chars = [...text];
  if (measure(text) <= width) return 0;
  const shown = (kept: number) =>
    side === 'start'
      ? ELLIPSIS + chars.slice(chars.length - kept).join('')
      : chars.slice(0, kept).join('') + ELLIPSIS;
  // The most characters that fit beside the ellipsis.
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(shown(mid)) <= width) lo = mid;
    else hi = mid - 1;
  }
  return chars.length - lo;
}

/** A run of label text in one style, keyed by what it is. */
export interface LabelPart {
  key: string;
  text: string;
  className?: string;
}

/** `parts` without `cut` characters from `side`, the ellipsis where
 *  they were. */
export function dropChars(
  parts: LabelPart[],
  cut: number,
  side: CutSide
): LabelPart[] {
  if (cut <= 0) return parts;
  const ordered = side === 'start' ? parts : [...parts].reverse();
  let left = cut;
  const kept: LabelPart[] = [];
  for (const part of ordered) {
    const chars = [...part.text];
    if (left >= chars.length) {
      left -= chars.length;
      continue;
    }
    const rest =
      side === 'start' ? chars.slice(left) : chars.slice(0, -left || undefined);
    kept.push({ ...part, text: rest.join('') });
    left = 0;
  }
  // No space between the ellipsis and the word it stands against:
  // `kept` is in cut order from either side, so that run comes first.
  const at = kept[0];
  if (at) {
    kept[0] = {
      ...at,
      text: side === 'start' ? at.text.trimStart() : at.text.trimEnd(),
    };
  }
  const ellipsis = { key: 'ellipsis', text: ELLIPSIS };
  return side === 'start' ? [ellipsis, ...kept] : [...kept.reverse(), ellipsis];
}
